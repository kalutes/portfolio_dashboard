"use client";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { saveManual } from "./actions";
import type { ManualAccount, ManualHolding } from "@/lib/manual/types";

function Form({
  children,
  submit,
  reset = false,
}: {
  children: ReactNode;
  submit: string;
  reset?: boolean;
}) {
  const [state, action, pending] = useActionState(saveManual, {
    ok: false,
    message: "",
    revision: 0,
  });
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && reset) ref.current?.reset();
  }, [state, reset]);
  return (
    <form ref={ref} action={action} className="manual-form">
      <fieldset disabled={pending}>
        {children}
        <button type="submit">{pending ? "Saving…" : submit}</button>
      </fieldset>
      {state.message && (
        <p
          className={state.ok ? "muted" : "notice error"}
          role={state.ok ? "status" : "alert"}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
export function AccountForm({ account }: { account?: ManualAccount }) {
  return (
    <Form submit={account ? "Save account" : "Add account"} reset={!account}>
      <input type="hidden" name="operation" value="account" />
      <input type="hidden" name="id" value={account?.id ?? ""} />
      <div className="form-grid">
        <label>
          Account name
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={account?.name}
            placeholder="Employer retirement"
          />
        </label>
        <label>
          Institution
          <input
            name="institution"
            required
            maxLength={120}
            defaultValue={account?.institution}
            placeholder="Brokerage"
          />
        </label>
      </div>
    </Form>
  );
}
export function HoldingForm({
  account,
  holding,
}: {
  account: ManualAccount;
  holding?: ManualHolding;
}) {
  return (
    <Form submit={holding ? "Save holding" : "Add holding"} reset={!holding}>
      <input type="hidden" name="operation" value="holding" />
      <input type="hidden" name="id" value={holding?.id ?? ""} />
      <input type="hidden" name="accountId" value={account.id} />
      <div className="form-grid">
        <label>
          Symbol or fund label
          <input
            name="symbol"
            required
            maxLength={80}
            defaultValue={holding?.symbol}
            placeholder="VTI or Retirement fund"
          />
        </label>
        <label>
          Description
          <input
            name="description"
            maxLength={240}
            defaultValue={holding?.description}
          />
        </label>
        <label>
          Quantity / units
          <input
            name="quantity"
            type="number"
            step="any"
            required
            defaultValue={holding?.quantity ?? 1}
          />
        </label>
        <label>
          Yahoo quote symbol (optional)
          <input
            name="quoteSymbol"
            maxLength={40}
            defaultValue={holding?.quoteSymbol}
            placeholder="VTI"
          />
        </label>
        <label>
          Manual total value ($, optional)
          <input
            name="manualValue"
            type="number"
            step="any"
            defaultValue={holding?.manualValue ?? ""}
          />
        </label>
        <label>
          Total cost basis ($, optional)
          <input
            name="costBasis"
            type="number"
            step="any"
            min="0"
            defaultValue={holding?.costBasis ?? ""}
          />
        </label>
        <label>
          Acquisition date (optional)
          <input
            name="acquiredDate"
            type="date"
            defaultValue={holding?.acquiredDate ?? ""}
          />
        </label>
        <label>
          Manual valuation date
          <input
            name="manualAsOf"
            type="date"
            defaultValue={holding?.manualAsOf ?? ""}
          />
        </label>
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          name="cashEquivalent"
          defaultChecked={holding?.cashEquivalent}
        />
        Cash or cash-equivalent holding
      </label>
      <p className="muted">
        Cost basis is the total cost of the remaining units, not the unit price.
        For multiple purchase lots, add separate holdings with the same symbol
        and their own quantities, costs, and dates. Quote price × quantity
        values the holding. For cash or funds without a quote, enter their total
        value and statement date. A manual value also provides a fallback if
        Yahoo is unavailable. Do not enter a cash balance that already includes
        a cash-equivalent holding entered separately.
      </p>
    </Form>
  );
}
export function DeleteForm({
  id,
  account = false,
}: {
  id: string;
  account?: boolean;
}) {
  return (
    <Form submit={account ? "Delete account" : "Delete holding"}>
      <input
        type="hidden"
        name="operation"
        value={account ? "deleteAccount" : "deleteHolding"}
      />
      <input type="hidden" name="id" value={id} />
      <label className="check-label">
        <input name="confirm" type="checkbox" required />
        {account
          ? "Delete this account and all its manual holdings"
          : "Delete this manual holding"}
      </label>
    </Form>
  );
}
