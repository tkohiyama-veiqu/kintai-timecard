// Firebase コンソール →「プロジェクトの設定」→「マイアプリ」→ ウェブアプリの「SDK の設定と構成」にある値を貼り付けてください。
export const firebaseConfig = {
  apiKey: "AIzaSyBI7TKElpd_ves4JaZjL2HSzeRm43ccB_s",
  authDomain: "kintai-ef377.firebaseapp.com",
  projectId: "kintai-ef377",
  storageBucket: "kintai-ef377.firebasestorage.app",
  messagingSenderId: "219593570852",
  appId: "1:219593570852:web:44d4f3af6b6ef80dc436b1"
};

// このメールアドレスでログインした人は、常に管理者になります（最初の管理者）。
// firestore.rules の OWNER_EMAIL と同じ値にしてください。
export const ownerEmail = "t.kohiyama@veiqu.co.jp";
