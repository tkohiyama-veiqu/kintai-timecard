# 勤怠タイムカード（独立版）

スマートフォンのホーム画面に入れて使える勤怠管理アプリです。アプリは **GitHub Pages** で公開し、ログインとデータ保存には **Firebase**（Google のサービス）を使います。

- 従業員：出勤・退勤・直行・直帰の打刻、休暇の登録、月のタイムカード、修正依頼
- 管理者：修正依頼の承認、今日の勤務状況、月次集計（残業・有給・代休）、有給の付与、従業員の承認
- 退勤した日は、従業員は変更できません（Firestore のルールで止めています）
- 電波がないときの打刻は端末に保存し、つながったときに送信します

## 構成

| 役割 | 担当 |
|---|---|
| アプリの公開（URL） | GitHub Pages（`main` に上げると自動で公開） |
| ログイン | Firebase Authentication |
| 勤怠データ・権限 | Cloud Firestore |

## フォルダの中身

| ファイル | 役割 |
|---|---|
| `public/` | アプリ本体（GitHub Pages で公開されるのはこの中だけ） |
| `public/firebase-config.js` | Firebase の接続設定と、オーナーのメールアドレス |
| `firestore.rules` | データの権限。Firebase コンソールに貼り付けて反映します |
| `firestore.indexes.json` | 管理者画面で全員分を読むための索引の定義（参考） |
| `.github/workflows/pages.yml` | GitHub Pages への自動公開の設定 |
| `firebase.json` | Firebase のコマンドを使う場合の設定（GitHub Pages 構成では使いません） |

## 準備（最初の1回）

### 1. Firebase プロジェクトを作る
1. https://console.firebase.google.com/ を開き、「プロジェクトを追加」でプロジェクトを作ります（例：`veiqu-kintai`）。Google アナリティクスは不要です
2. **Authentication** →「始める」→「ログイン方法」で次の2つを有効にします
   - Google
   - メール / パスワード
3. **Authentication** →「設定」→「承認済みドメイン」に、GitHub Pages のドメイン `<GitHubのユーザー名>.github.io` を追加します
4. **Firestore Database** →「データベースの作成」
   - ロケーション：`asia-northeast1（東京）`
   - 「本番環境モード」で開始
5. **Firestore Database** →「ルール」タブに `firestore.rules` の中身をすべて貼り付けて「公開」を押します
6. **Firestore Database** →「インデックス」→「単一フィールド」→「除外を追加」で次を登録します
   - コレクション ID：`days`
   - フィールドのパス：`date`
   - クエリのスコープ：「コレクショングループ」にチェック
   - インデックス：「昇順」を有効
7. **プロジェクトの設定**（歯車）→「マイアプリ」→ ウェブ（`</>`）を追加します。表示された `firebaseConfig` の値を `public/firebase-config.js` に貼り付けます

### 2. GitHub で公開する
1. GitHub で新しいリポジトリ `kintai-timecard` を作ります（Public、README などは追加しない）
2. このフォルダを GitHub に上げます
3. リポジトリの **Settings** →「Pages」→「Build and deployment」の Source を **GitHub Actions** にします
4. 「Actions」タブで「GitHub Pages に公開」が緑になれば完了です。URL は `https://<ユーザー名>.github.io/kintai-timecard/` です

### 3. 使い始める
1. オーナーのメールアドレスの Google アカウントでログインします（自動で管理者になります）
2. 従業員に URL を送ります。従業員は Google アカウントか、メールアドレスとパスワードでログインします。会社のドメインでなくても使えます
3. 管理者画面の「従業員の管理」に「承認待ち」で並ぶので、「承認」を押します。承認されると打刻できるようになります
4. 有給を使う人は、管理者画面の月次集計で名前をタップし、「有給の付与」を登録します

### 4. スマートフォンのホーム画面に入れる
- **iPhone**：Safari で URL を開く → 共有ボタン →「ホーム画面に追加」
- **Android**：Chrome で URL を開く → メニュー →「アプリをインストール」（または「ホーム画面に追加」）

## 更新するとき
- **アプリ（public の中）を直したとき**：GitHub の `main` に上げると、数分で自動的に公開されます。開いているアプリは、次に起動したときに新しい版になります
- **権限（firestore.rules）を直したとき**：Firebase コンソールの「ルール」に貼り直して「公開」を押します

## オーナー（最初の管理者）を変えるとき
`public/firebase-config.js` の `ownerEmail` と、`firestore.rules` の `ownerEmail()` の2か所を同じ値にし、ルールを貼り直してください。

## 費用の目安
GitHub Pages は公開リポジトリなら無料です。Firebase も無料プラン（Spark）で、数十人規模なら収まる見込みです（Firestore は1日あたり読み取り5万回・書き込み2万回まで無料）。

## 注意
- リポジトリを Public にすると、プログラムとオーナーのメールアドレスは誰でも読めます。勤怠データは Firestore の権限で守られ、Firebase の接続情報（apiKey など）も公開して問題ない値です
- 打刻の時刻は、スマートフォンの時計を使います。あわせてサーバー側の時刻も記録しているので（`inAt` / `outAt`）、必要なら突き合わせられます
- 以前の claude.ai 版のデータは引き継がれません
