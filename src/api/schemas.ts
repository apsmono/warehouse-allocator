import { z } from "zod";
import type { Day } from "../engine/types.js";

const DAYS: readonly [Day, ...Day[]] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

export const orderLineSchema = z
  .object({
    productId: z.string().min(1, "Product ID is required"),
    quantity: z
      .number()
      .int("Must be an integer >= 1")
      .min(1, "Must be an integer >= 1")
      .max(100_000, "Must be <= 100000"),
  })
  .strict();

export const dispatchAtSchema = z
  .object({
    day: z.enum(DAYS),
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be 24h time in HH:MM format"),
  })
  .strict();

export const allocationOptionsSchema = z
  .object({
    allowSplit: z.boolean().default(true),
    strategy: z.enum(["distance", "time-aware"]).default("distance"),
    dispatchAt: dispatchAtSchema.optional(),
  })
  .strict()
  .superRefine((options, ctx) => {
    if (options.strategy === "time-aware" && options.dispatchAt === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["dispatchAt"],
        message: "dispatchAt is required when strategy is 'time-aware'",
      });
    }
    if (options.strategy === "distance" && options.dispatchAt !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["dispatchAt"],
        message: "dispatchAt is only allowed when strategy is 'time-aware'",
      });
    }
  });

export const allocationRequestSchema = z
  .object({
    lines: z
      .array(orderLineSchema)
      .min(1, "Order must contain at least 1 line")
      .max(20, "Order cannot exceed 20 lines"),
    options: allocationOptionsSchema.default({
      allowSplit: true,
      strategy: "distance",
    }),
  })
  .strict();

export type AllocationRequest = z.infer<typeof allocationRequestSchema>;
