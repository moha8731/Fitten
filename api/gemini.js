// BulkMind v14 Vercel serverless Gemini proxy
// Put your Gemini key in Vercel Environment Variables as GEMINI_API_KEY.
// Never put a real API key inside GitHub/frontend files.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).send('Method not allowed');
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'Missing GEMINI_API_KEY in Vercel Environment Variables. Paste the Gemini key/auth key from Google AI Studio.'
    });
  }

  try {
    const { model = 'gemini-2.5-flash', body } = req.body || {};
    if (!body || !Array.isArray(body.contents)) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(text);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Gemini proxy failed' });
  }
}
