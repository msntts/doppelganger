---
name: analyze-observer
description: |
  observer-log.jsonl と claude insights HTML を組み合わせて判断帰属を分析する。
  「observer 分析して」「post_ai の比率見たい」「スキル別承認率を出して」
  「insights と合わせて分析」「判断帰属レポート」「改善トレンドを見たい」等で使う。

  ⚠️ **引数に insights HTML のパスが必要**（複数指定で期間比較）:
    /analyze-observer ~/path/to/report-YYYY-MM-DD.html
    /analyze-observer ~/path/to/report-old.html ~/path/to/report-new.html

  HTML は `claude insights` コマンドで生成できます。
  2つ目以降は省略可能。複数指定すると期間別トレンド比較が追加されます。
user-invocable: true
allowed-tools: Read, Bash
---

## 実行フロー

### 1. 引数チェック

引数が空または HTML パスが渡されていない場合、以下を表示して終了する:

```
insights HTML のパスを引数で渡してください:
  /analyze-observer ~/path/to/report-YYYY-MM-DD.html

複数指定（期間比較）も可能:
  /analyze-observer ~/path/to/report-old.html ~/path/to/report-new.html

HTML は以下で生成できます:
  claude insights
```

引数のパスを空白で分割し、HTML ファイルのリストとして扱う。

### 2. データ収集（並列）

以下を同時に読み込む:
- `~/.claude/observer-log.jsonl` — Bash で `cat` して全行取得
- 引数の各 HTML パス — Read ツールで取得（複数あれば並列）

### 3. observer-log.jsonl 分析

**user_turn エントリ**を集計する:

| 集計軸 | 内容 |
|---|---|
| 帰属サマリ | autonomous / post_ai の件数・比率 |
| スキル別内訳 | preceding_skill ごとの件数 |
| response_type 別 | approval / modification / rejection / unclear の件数・比率（post_ai のみ） |
| スキル×response_type | スキル別の承認率・修正率・拒否率 |
| 応答速度 | ai_elapsed_sec の中央値（スキル別） |

**review_verdict エントリ**（`event_type: "review_verdict"`）を集計する:

| 集計軸 | 内容 |
|---|---|
| 判定別件数 | 要修正 / 要確認 / 問題なし の件数・比率 |
| 直近トレンド | 直近 10 件の判定推移（古い順に並べる） |

**agent_invoked エントリ**:
- agent_description 別の件数

### 4. 各 insights HTML から補足情報を抽出

各 HTML を読み込み、以下の情報を把握する（テキストとして解釈、厳密なパースは不要）:
- 総メッセージ数・セッション数・期間
- 主な摩擦カテゴリと件数
- User Response Time Distribution（中央値）
- Top Tools
- Outcomes（Fully Achieved / Mostly Achieved / Partially Achieved / Not Achieved）

### 5. 統合レポートを出力

#### HTML が1つの場合（単体分析）

```
## Observer 分析レポート
期間: {insights の期間}　|　observer ログ: {N} エントリ

### 判断帰属サマリ
| 種別       | 件数 | 比率 |
|-----------|------|------|
| autonomous | N   | XX%  |
| post_ai    | N   | XX%  |

### post_ai 内訳（スキル別）
| スキル | 件数 | approval | modification | rejection | unclear | 中央値応答(秒) |
|--------|------|----------|--------------|-----------|---------|--------------|
| review | N    | N(XX%)   | N(XX%)       | N(XX%)    | N(XX%)  | N            |
| ...    |      |          |              |           |         |              |

### /review 判定サマリ
| 判定     | 件数 | 比率 |
|---------|------|------|
| 要修正   | N    | XX%  |
| 要確認   | N    | XX%  |
| 問題なし  | N    | XX%  |

直近 10 件: {古→新 順に 🔴/🟡/🟢 を並べたもの（例: 🟢🟢🟡🔴🟢）}

### Agent 呼び出し
| description | 件数 |
|-------------|------|
| ...         | N    |

### insights との照合
- insights 総メッセージ {N} 件 / observer 捕捉 {M} 件（{X}%）
- 主な摩擦カテゴリ（insights）と rejection 率の関係

### 所見
{observer データと insights を統合した考察。
「このスキルの後に修正が多い」「自律判断の比率が高い時間帯」等、
両データを掛け合わせた洞察を述べる}
```

#### HTML が2つ以上の場合（期間比較分析）

単体分析レポートに加え、以下の比較セクションを追加する。
HTML は期間の古い順（ファイル名の日付順）に並べて比較する。

```
## 期間比較レポート
{ファイル1の期間} → {ファイル2の期間} [→ ...]

### insights メトリクス推移
| 指標                    | {期間1}    | {期間2}    | 変化      |
|------------------------|-----------|-----------|----------|
| 総メッセージ数           | N         | N         | ±N       |
| Fully Achieved 率       | XX%       | XX%       | ±XX%     |
| Not Achieved 率         | XX%       | XX%       | ±XX%     |
| 主要摩擦（Wrong Approach）| N件       | N件       | ±N       |
| 主要摩擦（Buggy Code）   | N件       | N件       | ±N       |
| 応答時間 中央値          | Xs        | Xs        | ±Xs      |

### observer メトリクス推移
observer ログの timestamp を各 insights 期間に対応させて分割し、
各期間の post_ai 比率・スキル承認率・approval 率を比較する。
期間が重ならない場合は「observer データなし」と表示する。

| 指標                    | {期間1}    | {期間2}    | 変化      |
|------------------------|-----------|-----------|----------|
| post_ai 比率            | XX%       | XX%       | ±XX%     |
| review 後 approval 率   | XX%       | XX%       | ±XX%     |
| review 後 unclear 率    | XX%       | XX%       | ±XX%     |
| /review 要修正率         | XX%       | XX%       | ±XX%     |
| 中央値応答(秒)           | N         | N         | ±N       |

### トレンド所見
{複数期間を通じた改善・悪化の傾向。
「承認率が上がっているなら review スキルへの信頼が高まっている」
「Not Achieved が増えているなら新しい摩擦が発生している」等、
変化の背景を insights と observer の両データから解釈する}
```
