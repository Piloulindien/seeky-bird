# Seeky Bird

Seeky Bird is a competitive on-chain arcade game built on **Solana** where players compete for real **SOL rewards**.

Players pay small entry fees to play runs. Scores are verified server-side and the best players win prizes from pooled rewards.

The project combines **classic arcade gameplay** with **provably fair scoring and Solana payments**.

---

# 🎮 Game Modes

### Normal Mode

Players enter a shared reward pool.

* Each paid run contributes to the pool
* When the pool reaches a threshold, the **Top 10 players win**
* Payouts are automatically distributed

### Daily Challenge

A daily competition where players try to reach the highest score.

* One leaderboard per day
* Top players win the daily pool
* Scores are replay-verified

### SuperPrize Events

Large tournament-style competitions.

* Fixed prize pools
* Limited entry
* **Top 3 players win**

---

# ⚙️ How It Works

1. Player connects a **Solana wallet**
2. Player buys a run
3. Game generates a **deterministic seed**
4. Player gameplay is recorded (tap timestamps)
5. Server re-simulates the run
6. Score is validated
7. Leaderboards update
8. Rewards are distributed

This prevents cheating because **scores are replayed server-side**.

---

# 🔐 Security

The system includes several protections:

* Signed wallet messages
* One-time receipts for runs
* Deterministic replay verification
* Server-side score simulation
* Leaderboard validation
* Admin payout controls

Runs cannot be reused and scores cannot be forged.

---

# 🧠 Tech Stack

* **Next.js 16**
* **TypeScript**
* **Phaser.js** (game engine)
* **Solana Web3.js**
* **SQLite (Better-SQLite3)**

The game runs fully in the browser and interacts with Solana wallets for payments.

---

# 📱 Solana Mobile

Seeky Bird is designed to run inside the **Solana Mobile dApp ecosystem**.

Wallet interactions use:

* `signTransaction`
* `signMessage`

This makes the game compatible with mobile Solana wallets.

---

# 🏗 Project Structure

```
src
 ├ app
 │ ├ api
 │ │ ├ normal
 │ │ ├ daily
 │ │ └ superprize
 │ ├ play
 │ ├ leaderboard
 │ └ rewards
 ├ game
 │ ├ createGame.ts
 │ └ scene.ts
 ├ server
 │ ├ runsStore.ts
 │ ├ normalCore.ts
 │ ├ daily.ts
 │ └ superprize.ts
 └ lib
```

---

# 🚀 Running the Project

Install dependencies:

```
npm install
```

Start development server:

```
npm run dev
```

Build production:

```
npm run build
npm run start
```

---

# 🔑 Environment Variables

Create `.env.local` using `.env.example`.

Important variables include:

```
SOLANA_RPC_URL
NEXT_PUBLIC_SOLANA_RPC_URL
TREASURY_SECRET_KEY_B58
TREASURY_PUBKEY
PAYOUT_SECRET_KEY_B58
PAYOUT_PUBKEY
```

These wallets handle game payments and reward distribution.

---

# 🏆 Hackathon Submission

Seeky Bird demonstrates how **arcade games can integrate Solana payments and trustless score verification**.

Key ideas:

* Competitive gameplay
* Real token rewards
* Secure replay-verified scoring
* Solana wallet payments
* Mobile compatibility

---

# 👤 Author

Pierre-Louis Le Roux
