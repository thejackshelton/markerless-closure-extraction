import { Button } from "./Button";

type ToolbarButtonProps = {
  label: string;
  onActivate: () => void;
};

export function ToolbarButton({ label, onActivate }: ToolbarButtonProps) {
  return <Button onPress={onActivate}>{label}</Button>;
}
