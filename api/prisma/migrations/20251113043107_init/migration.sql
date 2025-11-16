-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email_masked" TEXT NOT NULL,
    "kyc_level" TEXT NOT NULL DEFAULT 'LVL_1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_id" TEXT NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "balance_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_id" TEXT NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "mcc" TEXT NOT NULL,
    "merchant" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "ts" TIMESTAMPTZ NOT NULL,
    "device_id" TEXT,
    "country" TEXT NOT NULL,
    "city" TEXT,
    "customer_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "risk" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "suspect_txn_id" TEXT,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "customer_id" TEXT NOT NULL,
    "txn_id" TEXT,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseEvent" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload_json" JSONB,
    "case_id" TEXT NOT NULL,

    CONSTRAINT "CaseEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriageRun" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "risk" TEXT NOT NULL,
    "reasons" JSONB,
    "fallback_used" BOOLEAN NOT NULL DEFAULT false,
    "latency_ms" INTEGER,
    "alert_id" TEXT NOT NULL,

    CONSTRAINT "TriageRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTrace" (
    "run_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "step" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "detail_json" JSONB,

    CONSTRAINT "AgentTrace_pkey" PRIMARY KEY ("run_id","seq")
);

-- CreateTable
CREATE TABLE "KbDoc" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "content_text" TEXT NOT NULL,

    CONSTRAINT "KbDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content_text" TEXT NOT NULL,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_masked_key" ON "Customer"("email_masked");

-- CreateIndex
CREATE INDEX "Card_customer_id_idx" ON "Card"("customer_id");

-- CreateIndex
CREATE INDEX "Account_customer_id_idx" ON "Account"("customer_id");

-- CreateIndex
CREATE INDEX "Transaction_customer_id_ts_idx" ON "Transaction"("customer_id", "ts" DESC);

-- CreateIndex
CREATE INDEX "Transaction_merchant_idx" ON "Transaction"("merchant");

-- CreateIndex
CREATE INDEX "Transaction_mcc_idx" ON "Transaction"("mcc");

-- CreateIndex
CREATE INDEX "Transaction_customer_id_merchant_idx" ON "Transaction"("customer_id", "merchant");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_customer_id_id_key" ON "Transaction"("customer_id", "id");

-- CreateIndex
CREATE INDEX "Alert_customer_id_idx" ON "Alert"("customer_id");

-- CreateIndex
CREATE INDEX "Alert_status_created_at_idx" ON "Alert"("status", "created_at");

-- CreateIndex
CREATE INDEX "Case_customer_id_idx" ON "Case"("customer_id");

-- CreateIndex
CREATE INDEX "Case_status_idx" ON "Case"("status");

-- CreateIndex
CREATE INDEX "CaseEvent_case_id_ts_idx" ON "CaseEvent"("case_id", "ts" DESC);

-- CreateIndex
CREATE INDEX "TriageRun_alert_id_idx" ON "TriageRun"("alert_id");

-- CreateIndex
CREATE UNIQUE INDEX "KbDoc_anchor_key" ON "KbDoc"("anchor");

-- CreateIndex
CREATE UNIQUE INDEX "Policy_code_key" ON "Policy"("code");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_suspect_txn_id_fkey" FOREIGN KEY ("suspect_txn_id") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_txn_id_fkey" FOREIGN KEY ("txn_id") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseEvent" ADD CONSTRAINT "CaseEvent_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriageRun" ADD CONSTRAINT "TriageRun_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "Alert"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTrace" ADD CONSTRAINT "AgentTrace_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "TriageRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
