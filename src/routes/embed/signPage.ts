export function signingPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign document</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Alex+Brush&family=Caveat:wght@400..700&family=Dancing+Script:wght@400..700&family=Great+Vibes&family=Mrs+Saint+Delafield&family=Pacifico&family=Sacramento&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/embed/sign.css" />
</head>
<body>
  <div class="wrap" id="app"><p class="muted">Loading…</p></div>
  <script src="/embed/sign.js"></script>
</body>
</html>`;
}
