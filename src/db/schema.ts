import {
  pgTable,
  serial,
  integer,
  bigint,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const telegramUser = pgTable("telegram_user", {
  id: serial("id").primaryKey(),
  chatId: bigint("chat_id", { mode: "number" }).notNull().unique(),
  notificationsEnabled: boolean("notifications_enabled")
    .notNull()
    .default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: serial("id").primaryKey(),
    telegramUserId: integer("telegram_user_id")
      .notNull()
      .references(() => telegramUser.id, { onDelete: "cascade" }),
    country: varchar("country", { length: 2 }).notNull(),
    brand: varchar("brand", { length: 20 }).notNull(),
    planId: varchar("plan_id", { length: 64 }).notNull(),
    memory: varchar("memory", { length: 64 }).notNull(),
    disk: varchar("disk", { length: 64 }).notNull(),
    price: varchar("price", { length: 32 }).notNull(),
    lastNotifiedAt: timestamp("last_notified_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_sub").on(t.telegramUserId, t.country, t.brand, t.planId),
    index("poll_idx").on(t.country, t.brand),
  ],
);

export const telegramUserRelations = relations(telegramUser, ({ many }) => ({
  subscriptions: many(subscriptions),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  telegramUser: one(telegramUser, {
    fields: [subscriptions.telegramUserId],
    references: [telegramUser.id],
  }),
}));

export type TelegramUser = typeof telegramUser.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
