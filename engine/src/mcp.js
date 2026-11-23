/*
 * MCP server: distribution for the basic estimate (docs/PRODUCT_STRATEGY.md, decision 3).
 *
 * Tools return the same ungated summary as the website, never the full report. Caveats travel
 * as fields (coverage, quotes_needed, unassessed scope), not only as prose an agent can drop.
 * Each estimate links to the full cited report on the website, behind the same email gate.
 */
'use strict';
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { EngineError } = require('./engine');

const VERSION = '1.0.0';

function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

/** Website link that opens this estimate pre-filled; the full report stays behind email capture. */
function reportUrl(appUrl, { county, parcel, label, project }) {
  const payload = Buffer.from(JSON.stringify({ county, parcel, label, project })).toString('base64url');
  return `${appUrl.replace(/\/$/, '')}/?estimate=${payload}`;
}

function estimateText(s, url) {
  const lines = [
    `${s.project_label} at ${s.parcel.label} (${s.parcel.jurisdiction}${s.parcel.zoning ? `, zoning ${s.parcel.zoning}` : ''}).`,
    `Permitting and pre-construction allowance: ${money(s.estimate.low)} to ${money(s.estimate.high)}.`,
  ];
  if (s.possible) lines.push(`Possible additional allowances if site conditions trigger them: up to ${money(s.possible.high)}.`);
  lines.push(`Agencies and districts: ${s.agencies.firm} required or likely, ${s.agencies.possible} possible.`);
  if (s.quotes_needed) lines.push(`${s.quotes_needed} cost item(s) have no published price and are NOT included; they need quotes.`);
  if (!s.coverage.complete) lines.push(s.coverage.unread_layers.length
    ? `Coverage incomplete: ${s.coverage.unread_layers.length} map layer(s) could not be read (${s.coverage.unread_layers.join(', ')}), so the range may be low.`
    : 'Coverage incomplete: local buffers or jurisdiction are unresolved, so the range may be low.');
  if (s.unassessed_scope.length) lines.push(`Not separately estimated: ${s.unassessed_scope.map((x) => x.label).join(', ')}.`);
  lines.push(`Full cited report (every agency, study and fee with its source): ${url}`);
  lines.push(`Screening estimate from public maps and published fee schedules${s.checked ? ` (sources checked ${s.checked})` : ''}. Not an approval, a determination or a quote.`);
  return lines.join('\n');
}

const projectShape = {
  type: z.string().describe('Project type id from get_coverage, e.g. new_sfr, adu, addition, accessory, rebuild, shoreline_structure, short_plat, clearing.'),
  new_sqft: z.number().min(0).max(100000).optional().describe('New building floor area in sq ft. Omit to use the project-type default.'),
  bedrooms: z.number().int().min(0).max(20).optional(),
  lots: z.number().int().min(0).max(50).optional().describe('New lots, for short_plat.'),
  hard_surface_sqft: z.number().min(0).max(1000000).optional().describe('New or replaced hard surface (roof, driveway, paving).'),
  disturbance_sqft: z.number().min(0).max(5000000).optional().describe('Land disturbed.'),
  grading_cy: z.number().min(0).max(1000000).optional().describe('Grading, cut plus fill, cubic yards.'),
  construction_value: z.number().min(0).max(100000000).optional().describe('Estimated construction valuation in dollars, if known.'),
  water: z.enum(['public', 'well_existing', 'well_new', 'unknown']).optional(),
  wastewater: z.enum(['sewer', 'septic_existing', 'septic_new', 'unknown']).optional(),
  demo: z.boolean().optional().describe('Demolition of an existing structure.'),
  tree_clearing: z.boolean().optional().describe('Clearing of forested land.'),
  in_water: z.boolean().optional().describe('Work at or below the ordinary high water line.'),
  state_highway_access: z.boolean().optional(),
  federal_nexus: z.boolean().optional().describe('Other federal permit, funding or action.'),
  common_plan: z.boolean().optional().describe('Part of a larger common development plan.'),
  floodplain_modification: z.boolean().optional(),
  scope_items: z.array(z.string()).max(20).optional().describe('Systems and upgrades from get_coverage (solar, heat_pump, ...). Captured but not priced yet.'),
};

/**
 * One server per request (stateless Streamable HTTP). ctx: { engine, events, appUrl, limit(name) }.
 */
function createMcpServer(ctx) {
  const server = new McpServer({ name: 'davapprove', version: VERSION }, {
    instructions: 'Davapprove screens a residential property for the permits, agencies, studies and fees a building project is likely to involve, and returns a cost range. Coverage: Kitsap, King and Skagit counties, Washington, USA. Results are screening estimates, not approvals or quotes. When presenting an estimate, always state items that need quotes, incomplete map coverage and scope that was not estimated, and share the report_url for the cited details.',
  });
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

  function failure(error) {
    const code = error instanceof EngineError ? error.code : 'engine_error';
    const message = error instanceof EngineError ? error.message : 'The estimate could not be completed. Retry shortly.';
    return { isError: true, content: [{ type: 'text', text: message }], structuredContent: { status: 'error', code, message } };
  }

  server.registerTool('get_coverage', {
    title: 'Coverage, project types and scope items',
    description: 'Lists supported counties, project type ids and scope item ids. Call this first if unsure whether a location or project is supported.',
    annotations: { ...readOnly, openWorldHint: false },
    outputSchema: { counties: z.array(z.object({ id: z.string(), name: z.string(), state: z.string(), tier: z.string() })), project_types: z.record(z.string(), z.string()), scope_items: z.record(z.string(), z.string()), reference_revision: z.string().nullable() },
  }, async () => {
    ctx.events.log({ event: 'mcp_tool_call', source: 'mcp', status: 'get_coverage' });
    const { project_type_defaults: _defaults, ...coverage } = ctx.engine.coverage();
    return { content: [{ type: 'text', text: `Supported: ${coverage.counties.map((c) => c.name).join('; ')}. Project types: ${Object.keys(coverage.project_types).join(', ')}.` }], structuredContent: coverage };
  });

  server.registerTool('search_parcels', {
    title: 'Find a parcel',
    description: 'Searches county parcel records in supported counties by street address or parcel number. Returns parcel keys for estimate_permit_costs. Never returns owner names.',
    inputSchema: { query: z.string().min(3).max(120).describe('Street address (house number and street) or parcel number.') },
    annotations: readOnly,
    outputSchema: { status: z.enum(['ok', 'no_match', 'error']), hits: z.array(z.object({ label: z.string(), sublabel: z.string().nullable(), parcel_key: z.string(), county: z.string(), county_name: z.string() })).optional(), failed_counties: z.array(z.string()).optional(), truncated: z.boolean().optional(), code: z.string().optional(), message: z.string().optional() },
  }, async ({ query }) => {
    const gate = ctx.limit('search');
    if (gate) return gate;
    try {
      const result = await ctx.engine.search(query);
      ctx.events.log({ event: 'search_run', source: 'mcp', status: result.hits.length ? 'match' : 'no_match' });
      const status = result.hits.length ? 'ok' : 'no_match';
      const text = result.hits.length
        ? result.hits.map((h) => `${h.label} — ${h.county_name} (county: ${h.county}, parcel_key: ${h.parcel_key})`).join('\n')
        : 'No parcel matched in Kitsap, King or Skagit counties. The address may be outside current coverage, or try the house number and street name only.';
      return { content: [{ type: 'text', text: text + (result.failed_counties.length ? `\nCould not search: ${result.failed_counties.join(', ')} (retry later).` : '') }], structuredContent: { status, ...result } };
    } catch (error) { return failure(error); }
  });

  server.registerTool('estimate_permit_costs', {
    title: 'Estimate permitting costs for a project',
    description: 'Screens a parcel for the agencies, permits, studies and fees a residential project is likely to need, and returns a low-high allowance in dollars. Give county + parcel_key from search_parcels, or an address. Present the quotes_needed, coverage and unassessed_scope caveats with the range, and share report_url for the cited details. This is a screening estimate, not an approval or a quote.',
    inputSchema: {
      county: z.string().optional().describe('County id from search_parcels or get_coverage, e.g. wa-kitsap.'),
      parcel_key: z.string().max(40).optional().describe('parcel_key from search_parcels.'),
      address: z.string().min(3).max(120).optional().describe('Street address, used when county and parcel_key are not given.'),
      project: z.object(projectShape).describe('What is being built.'),
    },
    annotations: readOnly,
    outputSchema: {
      status: z.enum(['ok', 'ambiguous', 'no_match', 'error']),
      estimate: z.object({ low: z.number(), high: z.number() }).optional(),
      possible_additional: z.object({ low: z.number(), high: z.number() }).nullable().optional(),
      quotes_needed: z.number().optional(),
      coverage: z.object({ complete: z.boolean(), unread_layers: z.array(z.string()) }).optional(),
      unassessed_scope: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
      agencies: z.object({ firm: z.number(), possible: z.number(), professionals: z.number() }).optional(),
      parcel: z.object({ label: z.string(), jurisdiction: z.string(), zoning: z.string().nullable() }).optional(),
      project_label: z.string().optional(),
      report_url: z.string().optional(),
      sources_checked: z.string().nullable().optional(),
      candidates: z.array(z.object({ label: z.string(), sublabel: z.string().nullable(), parcel_key: z.string(), county: z.string(), county_name: z.string() })).optional(),
      code: z.string().optional(),
      message: z.string().optional(),
      disclaimer: z.string().optional(),
    },
  }, async ({ county, parcel_key: parcelKey, address, project }) => {
    const gate = ctx.limit('estimate');
    if (gate) return gate;
    try {
      let target = county && parcelKey ? { county, parcel: parcelKey, label: '' } : null;
      if (!target) {
        if (!address) return failure(new EngineError(400, 'missing_location', 'Give county and parcel_key from search_parcels, or an address.'));
        const found = await ctx.engine.search(address);
        if (!found.hits.length) {
          ctx.events.log({ event: 'search_run', source: 'mcp', status: 'no_match' });
          return { content: [{ type: 'text', text: 'No parcel matched in Kitsap, King or Skagit counties, Washington. The address may be outside current coverage.' }], structuredContent: { status: 'no_match', message: 'No parcel matched in supported counties.' } };
        }
        if (found.hits.length > 1) {
          return { content: [{ type: 'text', text: 'Several parcels match. Ask which one, then call again with county and parcel_key:\n' + found.hits.map((h) => `${h.label} — ${h.county_name} (county: ${h.county}, parcel_key: ${h.parcel_key})`).join('\n') }], structuredContent: { status: 'ambiguous', candidates: found.hits } };
        }
        target = { county: found.hits[0].county, parcel: found.hits[0].parcel_key, label: found.hits[0].label };
      }
      const summary = await ctx.engine.estimate({ county: target.county, parcel: target.parcel, project });
      const normalProject = { ...project };
      const url = reportUrl(ctx.appUrl, { county: target.county, parcel: target.parcel, label: summary.parcel.label || target.label, project: normalProject });
      ctx.events.log({ event: 'estimate_run', source: 'mcp', status: 'ok', ...ctx.events.fromSummary(summary, project) });
      return {
        content: [{ type: 'text', text: estimateText(summary, url) }],
        structuredContent: {
          status: 'ok',
          estimate: summary.estimate,
          possible_additional: summary.possible,
          quotes_needed: summary.quotes_needed,
          coverage: summary.coverage,
          unassessed_scope: summary.unassessed_scope,
          agencies: { firm: summary.agencies.firm, possible: summary.agencies.possible, professionals: summary.agencies.professionals },
          parcel: { label: summary.parcel.label, jurisdiction: summary.parcel.jurisdiction, zoning: summary.parcel.zoning },
          project_label: summary.project_label,
          report_url: url,
          sources_checked: summary.checked,
          disclaimer: 'Screening estimate from public maps and published fee schedules. Not an approval, a determination or a quote. Items needing quotes are excluded from the range.',
        },
      };
    } catch (error) {
      ctx.events.log({ event: 'estimate_failed', source: 'mcp', status: error instanceof EngineError ? error.code : 'engine_error', county: county || undefined, project_type: project && project.type });
      return failure(error);
    }
  });

  return server;
}

module.exports = { createMcpServer, reportUrl, estimateText, VERSION };
