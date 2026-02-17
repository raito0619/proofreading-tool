export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'テキストが必要です' });
  }

  const apiKey = process.env.DIFY_API_KEY;
  const apiUrl = process.env.DIFY_API_URL || 'https://dify.pepalab.com/v1';

  if (!apiKey) {
    return res.status(500).json({ error: 'DIFY_API_KEY が設定されていません' });
  }

  try {
    const response = await fetch(`${apiUrl}/chat-messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        inputs: {},
        query: `以下の原稿を校正・校閲してください。必ずJSON形式のみで返してください。\n\n原稿:\n${text.slice(0, 15000)}`,
        response_mode: 'blocking',
        user: 'proofreading-tool'
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return res.status(500).json({
        error: `Dify API error: ${response.status}`,
        details: errorBody
      });
    }

    const data = await response.json();
    const resultText = data.answer || '';

    // JSON部分を抽出
    const jsonMatch = resultText.match(/\{[\s\S]*"factCheck"[\s\S]*\}/);

    if (jsonMatch) {
      const cleanJson = jsonMatch[0]
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      const parsedResults = JSON.parse(cleanJson);
      return res.status(200).json(parsedResults);
    } else {
      return res.status(500).json({
        error: 'JSON形式の結果が見つかりませんでした',
        rawResponse: resultText.substring(0, 1000)
      });
    }
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      stack: error.stack
    });
  }
}
