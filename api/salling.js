// BulkMind v19 Salling Group serverless proxy
// Put token in Vercel Environment Variables as SALLING_API_TOKEN.
// Browser calls: /api/salling?ean=571...&storeId=...

export default async function handler(req, res) {
  const token = process.env.SALLING_API_TOKEN;
  if (!token) {
    return res.status(500).json({ configured: false, error: 'Missing SALLING_API_TOKEN in Vercel Environment Variables' });
  }

  const { ean, storeId } = req.query || {};
  if (!ean || !storeId) {
    return res.status(200).json({
      configured: true,
      message: 'Salling token is configured. For product price lookup call /api/salling?ean=<barcode>&storeId=<storeId>.'
    });
  }

  try {
    const url = `https://api.sallinggroup.com/v2/products/${encodeURIComponent(ean)}?storeId=${encodeURIComponent(storeId)}`;
    const upstream = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });
    const text = await upstream.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: data.errorMessage || data.message || `Salling API ${upstream.status}`,
        details: data
      });
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Salling proxy failed' });
  }
}
