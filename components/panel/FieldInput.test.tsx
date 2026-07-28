import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { FieldSchema, FieldValue } from "@/lib/providers/types";
import { FieldInput } from "./FieldInput";

const field = (overrides: Partial<FieldSchema> & Pick<FieldSchema, "type">): FieldSchema => ({
  key: "example",
  label: "Example",
  required: false,
  ...overrides,
});

/**
 * Wrapper that feeds each change back in as the new value.
 *
 * `FieldInput` is controlled, so a test that types more than one character needs the value to
 * advance between keystrokes — otherwise the box resets and only the last character survives.
 */
function ControlledField({
  schema,
  initial,
  onChange,
}: {
  schema: FieldSchema;
  initial: FieldValue;
  onChange: (value: FieldValue) => void;
}) {
  const [value, setValue] = useState<FieldValue>(initial);
  return (
    <FieldInput
      field={schema}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("FieldInput", () => {
  it("renders a text box for a string field and reports each keystroke", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FieldInput field={field({ type: "string" })} value="" onChange={onChange} />);

    await user.type(screen.getByLabelText("Example"), "hi");

    expect(onChange).toHaveBeenCalledWith("h");
  });

  it("marks required fields", () => {
    render(
      <FieldInput field={field({ type: "string", required: true })} value="" onChange={vi.fn()} />,
    );
    expect(screen.getByText("*")).toBeInTheDocument();
  });

  it("renders a checkbox for a bool field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FieldInput field={field({ type: "bool" })} value={false} onChange={onChange} />);

    await user.click(screen.getByRole("checkbox"));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("renders a select listing every enum option", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FieldInput
        field={field({ type: "enum", options: ["INGRESS", "EGRESS"] })}
        value="INGRESS"
        onChange={onChange}
      />,
    );

    const select = screen.getByRole("combobox");
    expect(screen.getByRole("option", { name: "EGRESS" })).toBeInTheDocument();

    await user.selectOptions(select, "EGRESS");
    expect(onChange).toHaveBeenCalledWith("EGRESS");
  });

  it("reports a blank number field as empty rather than zero", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FieldInput field={field({ type: "number" })} value={5} onChange={onChange} />);

    await user.clear(screen.getByLabelText("Example"));

    // "" means unset; 0 would silently write a real value into the output.
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("splits a comma-separated list into an array", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ControlledField schema={field({ type: "stringList" })} initial={[]} onChange={onChange} />,
    );

    await user.type(screen.getByLabelText("Example"), "22, 80");

    expect(onChange).toHaveBeenLastCalledWith(["22", "80"]);
  });

  it("keeps a trailing separator visible so the next entry can be typed", async () => {
    const user = userEvent.setup();
    render(
      <ControlledField schema={field({ type: "stringList" })} initial={[]} onChange={vi.fn()} />,
    );

    const input = screen.getByLabelText("Example");
    await user.type(input, "22,");

    // Regression: deriving the text from the parsed array swallowed the comma immediately,
    // which made any list of more than one entry impossible to enter.
    expect(input).toHaveValue("22,");
  });

  it("joins an existing list back into the text box", () => {
    render(
      <FieldInput field={field({ type: "stringList" })} value={["22", "80"]} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText("Example")).toHaveValue("22, 80");
  });

  it("shows help text when the schema provides it", () => {
    render(
      <FieldInput
        field={field({ type: "string", help: "Must be globally unique." })}
        value=""
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Must be globally unique.")).toBeInTheDocument();
  });
});
