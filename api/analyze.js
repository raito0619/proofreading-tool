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

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY が設定されていません' });
  }

  const systemPrompt = `あなたはWebメディアの編集者です。以下の原稿を校正・校閲してください。

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
contextには修正箇所の前後1-2文を含めて、どこの部分かわかるようにしてください。`;

  try {
    const messages = [
      {
        role: 'user',
        content: `原稿:\n${text}`
      }
    ];

    // web_searchツール使用時、ツール呼び出しが返る場合があるのでループで処理
    let maxIterations = 10;
    let resultText = '';

    while (maxIterations > 0) {
      maxIterations--;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8000,
          system: systemPrompt,
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search'
            }
          ],
          messages: messages
        })
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('Anthropic API error body:', errorBody);
        throw new Error(`Anthropic API error: ${response.status} - ${errorBody}`);
      }

      const data = await response.json();

      // テキストとツール呼び出しを処理
      let hasToolUse = false;
      const toolResults = [];

      for (const block of data.content) {
        if (block.type === 'text') {
          resultText += block.text;
        } else if (block.type === 'tool_use') {
          hasToolUse = true;
          // web_searchはサーバーサイドで自動実行されるが、
          // 念のためツール結果を返す処理を用意
        } else if (block.type === 'server_tool_use') {
          hasToolUse = true;
        }
      }

      // stop_reasonがend_turnなら完了
      if (data.stop_reason === 'end_turn') {
        break;
      }

      // ツール呼び出しがあった場合、assistantの応答をmessagesに追加して続行
      if (hasToolUse || data.stop_reason === 'tool_use') {
        messages.push({
          role: 'assistant',
          content: data.content
        });

        // web_searchの結果を処理
        const webSearchResults = [];
        for (const block of data.content) {
          if (block.type === 'server_tool_use') {
            webSearchResults.push({
              type: 'server_tool_result',
              tool_use_id: block.id
            });
          }
        }

        if (webSearchResults.length > 0) {
          messages.push({
            role: 'user',
            content: webSearchResults
          });
        }

        continue;
      }

      break;
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
      console.error('No JSON found in result:', resultText.substring(0, 500));
      throw new Error('JSON形式の結果が見つかりませんでした');
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
