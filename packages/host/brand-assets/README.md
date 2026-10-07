# @deepseek-ai/dsh-host-brand-assets

CopyMonster brand image routes over the built frontend dist. It serves
`/brand.png`, `/brand-text.png`, `/brand-text-black.png`, `/favicon.png`, and
`/favicon.svg` as exact `webServer` routes ahead of the SPA dist fallback.

The SPA dist server leaves `.png` responses as `application/octet-stream` with
no cache directive, so Cloudflare and browsers apply long TTLs to the unhashed
brand URLs and keep serving a stale logo after the file changes. These routes
send the correct media type, a strong `etag`, and `cache-control: no-cache`, so
a changed logo is revalidated on the next request without changing its URL.

The image files stay owned by `apps/web/public` (copied into the served dist);
this package only changes how they are served. Replace a logo there, rebuild the
frontend, and restart the service.

This is a fork-only package: it is not part of the upstream DeepSeek Harness
tree and exists so branding survives upstream updates without editing upstream
sources.
