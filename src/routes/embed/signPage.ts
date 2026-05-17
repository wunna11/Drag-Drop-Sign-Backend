export function signingPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign document</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <link rel="stylesheet" href="/embed/sign.css" />
</head>
<body>
  <div class="wrap" id="app"><p class="muted">Loading…</p></div>
  <script src="/embed/sign.js"></script>
</body>
</html>`;
}
