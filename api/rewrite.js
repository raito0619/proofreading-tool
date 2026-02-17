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

  const { items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '修正項目が必要です' });
  }

  const apiKey = process.env.DIFY_API_KEY;
  const apiUrl = process.env.DIFY_API_URL || 'https://dify.pepalab.com/v1';

  if (!apiKey) {
    return res.status(500).json({ error: 'DIFY_API_KEY が設定されていません' });
  }

  try {
    // 各項目を整形
    const itemsText = items.map((item, i) => {
      return `【項目${i + 1}】\n原文: ${item.original}\n指示: ${item.aiHint}\n理由: ${item.reason}`;
    }).join('\n\n');

    const prompt = `あなたはプロの日本語校正者です。以下の各項目について、原文を修正してください。

ルール:
- 各項目について、修正案を2〜3個生成してください
- 修正案は自然な日本語で、原文の意味を保ったまま修正してください
- 指示に従って修正してください
- 余計な説明は不要です

必ず以下のJSON形式のみで返答してください（他のテキストは含めないでください）:
{
  "results": [
    {
      "index": 0,
      "corrections": ["修正案1", "修正案2", "修正案3"]
    },
    {
      "index": 1,
      "corrections": ["修正案1", "修正案2"]
    }
  ]
}

${itemsText}`;

    const response = await fetch(`${apiUrl}/chat-messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        inputs: {},
        query: prompt,
        response_mode: 'blocking',
        user: 'proofreading-rewrite'
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
    const jsonMatch = resultText.match(/\{[\s\S]*"results"[\s\S]*\}/);

    if (jsonMatch) {
      const cleanJson = jsonMatch[0]
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      const parsed = JSON.parse(cleanJson);
      return res.status(200).json(parsed);
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
