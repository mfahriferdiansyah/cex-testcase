CREATE TABLE "wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"frozen" boolean DEFAULT false,
	"encrypted_key" text NOT NULL,
	"balance" numeric(18, 6) DEFAULT '0',
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "wallets_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "withdrawal_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet_id" integer,
	"amount" text NOT NULL,
	"to_address" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "withdrawal_queue" ADD CONSTRAINT "withdrawal_queue_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;