# Bedrock Bot Console 0.3.4

Windows 11向けのMinecraft Bedrock Edition Bot管理アプリ試作版です。目標バージョンは **1.26.60** です。


## 0.3.4の診断ログ

- NetherNet HTTPでSDPオファーをPOSTする直前に、SDPの構造だけを要約した診断行をデスクトップの `bot-console-start.log` に出力します。
- 診断行の接頭辞は `[bedrock-bot-console] NETHERNET_OFFER_DIAG` です。
- 出力するのはSDPのサイズ、メディア形式、ICE候補の数・種別・UDP/TCP区分、fingerprintアルゴリズム数、`a=identity` の構造確認結果などです。
- 候補のIPアドレス・ポート、ICE ufrag/password、DTLS fingerprint値、JWT、署名、SDP本文、NetworkIDの値は出力しません。
- The HiveへのPOSTが400になった場合は、デスクトップの `bot-console-start.log` からこの診断行だけを共有してください。Microsoftの認証コードや他のログ全体を送る必要はありません。

この診断機能は送信内容を可視化するもので、接続方式を変更するものではありません。診断結果を見るまでは、The Hive側の拒否理由を断定できません。

## 0.3.2からの変更点（0.3.3）

- The Hiveへのシグナリング先を `http://ホスト:19132` から `https://as.nethernet.playhive.com` に変更しました。
- 旧版で保存済みのThe Hiveプロファイルも、設定読み込み時にHTTPSシグナリングURLへ自動移行します。Botの参加先ID、認証キャッシュ、既存の設定は保持します。
- サーバー鍵の確認・保存もHTTPSオリジン単位で行うようにしました。


## 0.3.3での接続修正

- NetherNetのSDP `a=identity` に、GameServerTokenの発行元である `https://authorization.franchise.minecraft-services.net` を `idp.domain` として設定します。0.3.2ではこの値が空になっていました。
- NetherNet HTTPのエラー時に、サーバーが返した応答本文（最大600文字）、Content-Type、Request IDをエラーに表示します。認証情報を含むSDPリクエスト本文はログに出しません。
- 既存のBot・認証キャッシュ・The HiveのHTTPS接続先設定はそのまま引き継ぎます。

この修正は公式NetherNetのIDP形式に合わせたものですが、The Hiveへの接続成功を確認したわけではありません。次回接続で400が続く場合は、表示される応答本文により拒否理由をさらに切り分けられます。

## 0.3.1から引き継いだ修正

- `bedrock-protocol` のバージョン確認を、固定コミットの実際のバージョン `3.60.1` に合わせています。
- パッチ対象ファイル内の既知コードが一致することを確認し、一致しない場合は自動変更を中止します。

- Botの追加時に参加先を指定する方式をやめ、Bot名だけで登録できるようにしました。
- Microsoft / Xboxアカウント認証とワールド参加は別操作です。認証後、Botごとに参加先を選びます。
- 公開サーバーは共有サーバー一覧に登録し、各Botから選択できます。
- The Hive（アジア）`as.nethernet.playhive.com:19132` のゲーム接続先と、`https://as.nethernet.playhive.com` のHTTPSシグナリング先をプリセットに設定しています。
- 公開サーバーの接続方式を「自動」「NetherNet HTTP」「RakNet」から選択できます。
- Xboxで参加可能なフレンドのワールドを検索し、一覧から選択できます。
- LANのNetherNet広告を検索し、取得したワールドに参加できます。
- 初回のNetherNet HTTP接続ではサーバーの公開鍵指紋を画面に表示し、ユーザーが承認した場合だけ保存します。保存済みの鍵と異なる場合は接続を拒否します。
- 接続先とBotごとの参加先は設定ファイルに保存されます。0.2.xのBot別ホスト・ポート設定も移行します。

## 接続先の種類

### 公開サーバー

「接続先を登録」で表示名・ホスト名・ポート・通信方式を保存します。登録後、Bot一覧の「参加先を選択」からそのサーバーを選べます。

- **自動判定**：RakNet / NetherNet LAN / NetherNet HTTPを順に探索します。
- **NetherNet HTTP**：LAN探索が使えない公開サーバー向けです。The Hiveプリセットはこの方式です。
- **RakNet**：旧方式のBedrockサーバー向けです。

The Hiveのアジア向けホスト名をゲーム接続先として、HTTPSのシグナリングURLを別に設定しています。2026-11-01の利用者による疎通確認では、旧HTTP URLは400、HTTPS URLは200を返しました。これはHTTPSのHTTPエンドポイントが応答することの確認であり、Botの参加・認証・スポーンまでの成功を示すものではありません。

### フレンドのワールド

Botの参加先で「フレンドのワールド」を選び「ワールド参加」を押すと、Microsoft / Xboxアカウントから参加可能なワールドセッションを取得します。表示された一覧から対象を選択します。参加可能なセッションがない場合は参加できません。

### LANワールド

Botの参加先で「LANワールド」を選ぶと「LAN検索」が表示されます。検索で受信したNetherNet広告から最初に見つかったワールドを選択・保存します。複数広告からの一覧選択や、Xboxセッション一覧とLAN広告の統合はまだ実装していません。

## 重要：NetherNet HTTPの実装状況

The HiveのようにLAN広告の探索だけでは接続できないサーバーを扱うため、`bedrock-protocol` のNetherNet HTTP対応開発ブランチを固定しています。

- `PrismarineJS/bedrock-protocol` PR #831 のコミット `b4160368b7e5272ccdd435f75459220c167fe4e4`
- `PrismarineJS/node-nethernet` の `feat/http-signalling` コミット `c46db7da4f0e97ec04487648f5759e3f23ff8e9c`

**このHTTP対応は、2026-11-01時点で上流にマージされていない開発実装です。** PRに記載された実機確認は、LAN可視性を無効にしたBDS 1.26.51.1でのオフライン・ループバック接続です。Microsoftオンライン認証を使った公開インターネット経由の接続、The Hiveへの接続、Minecraft 1.26.60での接続は確認済みではありません。

NetherNet HTTPの初回接続で表示される公開鍵指紋は、接続先の本人確認に使用します。接続先を自分で確認し、信頼できる場合だけ承認してください。アプリは未知の鍵を自動承認しません。鍵の保存後、次回は同じ鍵指紋を検証します。

## 動作条件

- Windows 11 64-bit
- Node.js 24以降（ユーザー環境ではNode.js 26.13.0の報告あり）
- 初回インストール時のインターネット接続
- Microsoft / Xbox認証を行う場合はMicrosoft認証へのインターネット接続
- 接続先サーバーへの参加権限

## 起動方法

1. ZIPを新しいフォルダーに展開します。旧版の`node_modules`はコピーしないでください。
2. `start.bat`を実行します。
3. 初回起動では`npm install`が実行されます。GitHub上の試験的な依存ライブラリも取得するため、初回インストールに時間がかかることがあります。
4. アプリが開いたら、Botを追加します。
5. 各Botの「アカウント認証」を実行します。Microsoftのデバイスコードが表示された場合は、指定された公式ページで入力します。
6. Botごとに参加先を選択します。
7. 「ワールド参加」を押します。

Botのアカウント認証が成功しても、Minecraftワールドにはまだ参加しません。ワールドへの通信は「ワールド参加」を押した時に開始します。

## ログ

`start.bat`で起動した場合、デスクトップに`bot-console-start.log`が作成されます。Electron内部の詳細ログは、通常 `%APPDATA%\bedrock-bot-console\logs\bot-console.log` に保存されます。問題の報告時は、Microsoftのパスワード・デバイスコード・アクセストークンなどを含めず、ログのエラー部分を共有してください。

## 現在の機能と制限

- 複数Botの登録・認証・接続先選択
- BotごとのMicrosoft / Xbox認証キャッシュ
- 公開サーバー接続先の共通登録・保存
- The Hiveアジア向けHTTP接続プリセット
- フレンドワールドのXboxセッション選択
- LAN NetherNet広告の検索
- 接続・スポーン段階のログと診断情報
- Botの前後左右・ジャンプ・ダッシュ操作
- 座標への経路探索移動（地形データ取得が利用できる場合）

次の点は未確認または未実装です。

- The Hiveへのオンライン認証付き実機接続（HTTP POST 400の原因切り分けを含む）
- Minecraft Bedrock 1.26.60での実機スポーンと移動
- フレンドワールド・LANワールドの複数Bot同時参加時の実機検証
- LAN検索で複数の広告を一覧表示する機能
- 採掘・ブロック設置・アイテム回収・チェスト操作
- Realms一覧からの選択
- インストーラー形式の配布

MineflayerのBedrock対応はコミュニティフォークの実験的なアダプターです。Bedrock通信ライブラリ、物理演算、チャンク処理など複数のコミュニティ実装を組み合わせています。Java Edition用Mineflayerの安定性と同等であるとは保証できません。

## 開発者向けチェック

```powershell
npm run check
```

JavaScript構文、依存バージョン、パッチ処理、Bot状態、設定移行、認証キャッシュ、画面操作の前提を含む単体テストを実行します。このチェックはElectronのWindows実起動、Microsoftオンライン認証、The Hiveへの接続、実ワールドでのスポーンを保証しません。
