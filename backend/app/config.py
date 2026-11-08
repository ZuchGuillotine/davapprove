import os
from dataclasses import dataclass
from pathlib import Path

@dataclass
class Settings:
    mode: str = os.getenv('DAVAPPROVE_MODE', 'supabase')
    data_dir: Path = Path(os.getenv('DATA_DIR', '.data'))
    supabase_url: str = os.getenv('SUPABASE_URL', '').rstrip('/')
    publishable_key: str = os.getenv('SUPABASE_PUBLISHABLE_KEY', '')
    worker_key: str = os.getenv('SUPABASE_SERVICE_ROLE_KEY', '')
    cors_origins: str = os.getenv('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173')
    max_pdf_bytes: int = int(os.getenv('MAX_PDF_BYTES', str(250*1024*1024)))
    max_pdf_pages: int = 500
    bucket: str = 'project-documents'
    email_delivery_enabled: bool = os.getenv('EMAIL_DELIVERY_ENABLED', 'false').lower() in ('true','1','yes')
    job_timeout_seconds: int = 1200
    ai_api_key: str = os.getenv('AI_API_KEY', '')
    ai_base_url: str = os.getenv('AI_BASE_URL', 'https://api.openai.com/v1')
    ai_model: str = os.getenv('AI_MODEL', '')
    ai_input_per_million: float = float(os.getenv('AI_INPUT_USD_PER_MILLION', '0'))
    ai_output_per_million: float = float(os.getenv('AI_OUTPUT_USD_PER_MILLION', '0'))
    ai_monthly_usd: float = min(5.0,float(os.getenv('AI_MONTHLY_USD', '5')))

    ai_provider: str = os.getenv('AI_PROVIDER', 'legacy')
    openai_api_key: str = os.getenv('OPENAI_API_KEY', '')
