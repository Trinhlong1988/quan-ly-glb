-- Bill giải trình (Mr.Long 16/7): thư viện sản phẩm theo ngành + bảng theo dõi bill đã sinh.
-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "industry_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_explains" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "dossier_id" INTEGER NOT NULL,
    "tid_id" INTEGER,
    "industry_id" INTEGER NOT NULL,
    "bill_date" TIMESTAMPTZ(3) NOT NULL,
    "total_amount" BIGINT NOT NULL,
    "bill_count" INTEGER NOT NULL,
    "file_path" TEXT NOT NULL,
    "created_by" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" INTEGER,

    CONSTRAINT "bill_explains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "products_industry_id_idx" ON "products"("industry_id");

-- CreateIndex
CREATE UNIQUE INDEX "bill_explains_code_key" ON "bill_explains"("code");

-- CreateIndex
CREATE INDEX "bill_explains_dossier_id_idx" ON "bill_explains"("dossier_id");
