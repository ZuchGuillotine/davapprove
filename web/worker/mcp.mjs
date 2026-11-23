import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { assess, ClientError } from './assessment.mjs';

export async function handleMcp(request, record) {
  const server = new McpServer({ name: 'davapprove-beta', version: '1.0.0' });
  server.registerTool('screen_parcel', {
    description: 'Screen a US residential parcel for permitting and study allowances. Use the five-digit Census county FIPS code. Unsupported counties return coverage status without an estimate.',
    inputSchema: {
      county_code: z.string().regex(/^\d{5}$/),
      parcel: z.string().max(50).optional(),
      project: z.object({ type: z.string(), scope_items: z.array(z.string()).max(12).optional() })
        .catchall(z.union([z.number(), z.boolean(), z.string().max(100)])).optional(),
    },
  }, async input => {
    try {
      const result = await assess(input, { source: 'mcp', detailed: true, record });
      let answer = result;
      if (result.report) {
        const params = new URLSearchParams({ county: result.screening.pack_id, parcel: input.parcel, project: JSON.stringify(input.project) });
        // The workspace reads route data from a fragment, outside the server request URL.
        const link = new URL('/?workspace=bids', request.url);
        link.hash = params.toString();
        answer = {
          supported: true, coverage: result.coverage, summary: result.summary,
          findings: result.report.findings, independent_checks: result.report.independent_checks,
          costs: result.report.costs, citations: result.data.citations, report_url: link.href,
        };
      }
      return { content: [{ type: 'text', text: JSON.stringify(answer) }], structuredContent: answer };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof ClientError ? error.message : 'Screening is unavailable right now.' }] };
    }
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
