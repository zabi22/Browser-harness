import * as SliderPrimitive from "@radix-ui/react-slider";

export function VSlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  format?: (v: number) => string;
}) {
  return (
    <div
      className={`flex flex-col items-center gap-2 ${props.disabled ? "opacity-40" : ""}`}
      title={props.disabled ? "Not supported by this model" : undefined}
    >
      <span className="font-mono text-[11px] text-primary">
        {props.format ? props.format(props.value) : props.value}
      </span>
      <SliderPrimitive.Root
        orientation="vertical"
        className="relative flex h-32 w-5 touch-none select-none flex-col items-center"
        value={[props.value]}
        min={props.min}
        max={props.max}
        step={props.step}
        disabled={!!props.disabled}
        onValueChange={(v) => {
          if (v[0] !== undefined) props.onChange(v[0]);
        }}
        aria-label={props.label}
      >
        <SliderPrimitive.Track className="relative w-1.5 grow overflow-hidden rounded-full bg-muted">
          <SliderPrimitive.Range className="absolute w-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-primary bg-background shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </SliderPrimitive.Root>
      <span className="text-center text-[10px] uppercase leading-tight tracking-wide text-muted-foreground">
        {props.label}
      </span>
    </div>
  );
}
