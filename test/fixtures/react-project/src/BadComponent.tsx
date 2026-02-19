import React from "react";

export function BadComponent(props: any) {
  return (
    <div onClick={props.onClick}>
      <img src={props.image} />
      <a onClick={() => console.log("clicked")}>Click me</a>
      <div onClick={props.onSelect} style={{ cursor: "pointer" }}>
        Item
      </div>
      {props.items.map((item: any) => (
        <div>{item.name}</div>
      ))}
    </div>
  );
}
