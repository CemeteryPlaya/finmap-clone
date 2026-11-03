CREATE TABLE "analytics_settings" (
	"company_id" bigint NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" text NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "analytics_settings_company_id_key_pk" PRIMARY KEY("company_id","key")
);
--> statement-breakpoint
ALTER TABLE "analytics_settings" ADD CONSTRAINT "analytics_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_settings" ADD CONSTRAINT "analytics_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;