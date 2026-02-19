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
    // 原稿からURLを抽出してアクセス確認
    const urls = text.match(/https?:\/\/[^\s\])"'」）>]+/g) || [];
    const urlResults = await Promise.all(
      urls.slice(0, 20).map(async (url) => {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const resp = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'follow',
            headers: { 'User-Agent': 'Mozilla/5.0 (proofreading-tool link checker)' }
          });
          clearTimeout(timeout);
          return { url, status: resp.status, ok: resp.ok };
        } catch (e) {
          return { url, status: 'error', ok: false, error: e.name === 'AbortError' ? 'タイムアウト' : e.message };
        }
      })
    );

    const urlReport = urlResults.length > 0
      ? `\n\nURL検証結果（サーバー側で実際にアクセスして確認済み）:\n${urlResults.map(r =>
          r.ok ? `- ${r.url} → ${r.status} OK` : `- ${r.url} → ${r.status === 'error' ? r.error : `HTTP ${r.status}`}（アクセス不可）`
        ).join('\n')}`
      : '';

    const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

    const prompt = `あなたはWebメディア専門のプロ校正者です。以下の原稿を校正・校閲し、問題箇所と具体的な修正文を提示してください。

今日の日付: ${today}
※日付や年号の誤りに注意してください。未来の日付を過去として記述していないか、年号が正しいか確認してください。

チェック項目:
1. factCheck: 事実と異なる可能性がある記述（数値、固有名詞、日付など）
2. linkCheck: URLの記述ミスや不適切なリンクテキスト。末尾の「URL検証結果」でアクセス不可と判定されたURLは必ず指摘してください
3. toneCheck: ですます調/である調の混在
4. typoCheck: 誤字脱字、不適切な漢字使用（形式名詞・補助動詞はひらがなが一般的）
5. readabilityCheck: 長すぎる文（80文字超）、語尾の連続重複、読点の多用
6. notationCheck: 表記ゆれ（サーバー/サーバ等の混在）

ルール:
- 各項目のcorrectionsには、具体的に修正した文章を2〜3案入れてください
- 「ですます調に統一してください」のような抽象的な指示ではなく、実際に書き換えた文を返してください
- 問題がないカテゴリは空配列にしてください
- 必ず以下のJSON形式のみで返答してください（他のテキストは含めないでください）

{
  "factCheck": [
    { "context": "該当箇所の前後を含む文脈", "original": "問題のある原文", "corrections": ["修正案1", "修正案2"], "reason": "修正理由" }
  ],
  "linkCheck": [],
  "toneCheck": [
    { "context": "文脈", "original": "原文", "corrections": ["修正案1", "修正案2", "修正案3"], "reason": "理由" }
  ],
  "typoCheck": [],
  "readabilityCheck": [],
  "notationCheck": []
}

原稿:
${text.slice(0, 15000)}${urlReport}`;

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

      // correctionsが無い項目にはcorrection互換性を追加
      const categories = ['factCheck', 'linkCheck', 'toneCheck', 'typoCheck', 'readabilityCheck', 'notationCheck'];
      categories.forEach(cat => {
        if (parsedResults[cat]) {
          parsedResults[cat] = parsedResults[cat].map(item => ({
            ...item,
            corrections: item.corrections || [item.correction].filter(Boolean),
            correction: (item.corrections && item.corrections[0]) || item.correction || null
          }));
        } else {
          parsedResults[cat] = [];
        }
      });

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
