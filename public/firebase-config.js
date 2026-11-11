// Firebase コンソール →「プロジェクトの設定」→「マイアプリ」→ ウェブアプリの「SDK の設定と構成」にある値を貼り付けてください。
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// このメールアドレスでログインした人は、常に管理者になります（最初の管理者）。
// firestore.rules の OWNER_EMAIL と同じ値にしてください。
export const ownerEmail = "t.kohiyama@veiqu.co.jp";
