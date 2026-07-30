const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#17223a"/>
  <path d="M16 16h11c8 0 13 4 13 11 0 5-2 8-6 10l10 11H33l-8-9v9h-9V16zm9 8v8h2c3 0 5-1 5-4s-2-4-5-4h-2z" fill="#f4f7fb"/>
  <path d="M43 16h9v32h-9z" fill="#63d5c6"/>
</svg>`;

export function GET() {
  return new Response(favicon, {
    headers: {
      "cache-control": "public, max-age=86400",
      "content-type": "image/svg+xml",
    },
  });
}
