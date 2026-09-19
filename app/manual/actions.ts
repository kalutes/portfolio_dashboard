"use server";
import { requireSession } from "@/lib/auth/require-session";
import { revalidatePath } from "next/cache";
import { withManualStore } from "@/lib/manual/store";
import {
  accountInput,
  holdingInput,
  ManualInputError,
} from "@/lib/manual/types";

export type ActionState = { message: string; ok: boolean; revision: number };
export async function saveManual(
  _previous: ActionState,
  data: FormData,
): Promise<ActionState> {
  await requireSession();
  try {
    const operation = data.get("operation");
    // Authenticated single-user edits. Next Server Actions also enforce same-origin POST protection.
    if (operation === "account") {
      const input = accountInput(data);
      withManualStore((store) => store.saveAccount(input));
    } else if (operation === "holding") {
      const input = holdingInput(data);
      withManualStore((store) => store.saveHolding(input));
    } else if (operation === "deleteAccount" || operation === "deleteHolding") {
      const id = data.get("id");
      if (
        typeof id !== "string" ||
        !id ||
        id.length > 64 ||
        data.get("confirm") !== "on"
      )
        throw new ManualInputError("Confirm deletion before continuing.");
      withManualStore((store) =>
        operation === "deleteAccount"
          ? store.deleteAccount(id)
          : store.deleteHolding(id),
      );
    } else throw new ManualInputError("Unknown operation.");
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof ManualInputError
          ? error.message
          : "Could not save changes. Check the database directory permissions and try again.",
      revision: Date.now(),
    };
  }
  revalidatePath("/manual");
  revalidatePath("/");
  return { ok: true, message: "Saved.", revision: Date.now() };
}
