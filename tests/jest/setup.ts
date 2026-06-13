jest.mock("react-native/Libraries/Animated/NativeAnimatedHelper", () => ({}), {
  virtual: true,
});

jest.mock("@rn-primitives/slot", () => {
  const React = require("react");
  const { View } = require("react-native");

  return {
    Slot: React.forwardRef((props: Record<string, unknown>, ref: unknown) =>
      React.createElement(View, { ...props, ref })
    ),
  };
});
