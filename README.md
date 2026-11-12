# roamr.

> Explore. Quest. Earn.

A mobile-first travel rewards app where travelers discover local quests on a 3D globe, verify visits with Groq Vision AI, and earn real USD cashback via PayPal.

## 📱 Download

[**Download APK →**](https://github.com/tsrinath2007/roamr./releases/latest/download/roamr.apk)

## 🌐 Website

Deployed on Render: [roamr.onrender.com](https://roamr.onrender.com)

## 🗂️ Structure

```
├── app/          # Expo React Native app (Android)
├── server/       # Node.js + Express backend (SQLite)
├── website/      # Landing page (Express static, deploy to Render)
└── supabase/     # Supabase auth & remote sync
```

## 🚀 Deploy Website to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New Web Service**
3. Connect your GitHub repo `tsrinath2007/roamr.`
4. Render auto-detects `render.yaml` — click **Deploy**

Or manually:
- **Root Directory:** `website`
- **Build Command:** `npm install`
- **Start Command:** `npm start`

## 🛠️ Local Development

```bash
# Backend
cd server && npm install && node src/index.js

# App
cd app && npm install && npx expo start --localhost

# Website
cd website && npm install && npm start
# → http://localhost:3000
```

## 🔑 Environment Variables

### App (`app/.env`)
```
EXPO_PUBLIC_API_URL=http://127.0.0.1:5000
EXPO_PUBLIC_MAPBOX_TOKEN=pk.xxx
EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=xxx
```

### Server (`server/.env`)
```
PAYPAL_CLIENT_ID=xxx
PAYPAL_CLIENT_SECRET=xxx
PAYPAL_SANDBOX=true
GROQ_API_KEY=xxx
GEMINI_API_KEY=xxx
ZAPIER_WEBHOOK_URL=https://hooks.zapier.com/...
```

## 📄 License

MIT
