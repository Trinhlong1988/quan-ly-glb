-- R48 Pha 4 — bảng change_tokens: version tăng mỗi thao tác (bump trong writeAudit) cho realtime poll.
CREATE TABLE "change_tokens" (
    "domain" TEXT NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "change_tokens_pkey" PRIMARY KEY ("domain")
);
