export type Json = Record<string, any>;
export type Project = {
  id: string;
  name: string;
  parcel_number: string;
  parcel: Json;
  jurisdiction: string;
  intent: Json;
  current_revision: number;
  created_at: string;
  role?: string;
};
export type Candidate = {
  id: string;
  title: string;
  source: string;
  url?: string;
  document_url?: string;
  record_date?: string;
  match_reason?: string;
  access_method?: string;
  access?: string;
  status?: string;
  size_bytes?: number;
  category?: string;
};
export type DocumentRecord = {
  id: string;
  title?: string;
  filename?: string;
  status?: string;
  source?: string;
  created_at?: string;
  page_count?: number;
  size_bytes?: number;
  [key: string]: any;
};
export type Fact = {
  id: string;
  key?: string;
  name?: string;
  value: any;
  review_status?: string;
  document_id?: string;
  page?: number;
  source_quote?: string;
  [key: string]: any;
};
export type Job = {
  id: string;
  status: string;
  stage?: string;
  progress?: number;
  error?: string;
  [key: string]: any;
};
export type Assessment = {
  revision: number;
  nodes: Json[];
  edges: Json[];
  actions: Json[];
  envelope: Json;
  coverage_gaps: any[];
  summary: any;
};
