import type { ReactNode } from "react";

type ButtonProps = {
  onPress: () => void;
  children: ReactNode;
};

export function Button(props: ButtonProps) {
  return (
    <button type="button" className="counter-button" onClick={props.onPress}>
      {props.children}
    </button>
  );
}
