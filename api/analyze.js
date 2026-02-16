export default async function handler(req, res) {
  // CORSヘッダー設定
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

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

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search'
          }
        ],
        messages: [
          {
            role: 'user',
            content: `あなたはWebメディアの編集者です。以下の原稿を校正・校閲してください。

以下の5つのカテゴリで分析し、必ずJSON形式のみで返してください。前後の説明は一切不要です。

返すJSONの構造:
{
  "factCheck": [{"context": "前後の文脈を含む部分", "original": "修正が必要な箇所", "correction": "修正案", "reason": "理由"}],
  "linkCheck": [{"context": "前後の文脈を含む部分", "original": "修正が必要な箇所", "correction": "修正案", "reason": "理由"}],
  "toneCheck": [{"context": "前後の文脈を含む部分", "original": "修正が必要な箇所", "correction": "修正案", "reason": "理由"}],
  "typoCheck": [{"context": "前後の文脈を含む部分", "original": "修正が必要な箇所", "correction": "修正案", "reason": "理由"}],
  "readabilityCheck": [{"context": "前後の文脈を含む部分", "original": "修正が必要な箇所", "correction": "修正案", "reason": "理由"}]
}

チェック項目:
1. factCheck: 固有名詞・サービス名の表記確認（必要に応じてWeb検索で正確性を確認）
2. linkCheck: URLの記載確認
3. toneCheck: 文体の統一（ですます調/である調の混在をチェック）
4. typoCheck: 誤字脱字・衍字
5. readabilityCheck: 語尾の重複、句読点、長文の分割提案

修正がない項目は空配列[]で返してください。
contextには修正箇所の前後1-2文を含めて、どこの部分かわかるようにしてください。

原稿:
${text}`
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json();

    let resultText = '';
    for (const item of data.content) {
      if (item.type === 'text') {
        resultText += item.text;
      }
    }

    const jsonMatch = resultText.match(/\{[\s\S]*"factCheck"[\s\S]*\}/);

    if (jsonMatch) {
      const cleanJson = jsonMatch[0]
        .replace(/```json/g, '')
        .replace(/```/g, '')
        .trim();

      const parsedResults = JSON.parse(cleanJson);
      return res.status(200).json(parsedResults);
    } else {
      throw new Error('JSON形式の結果が見つかりませんでした');
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
