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

// NetInfo has no native module under Jest; use the library's own mock unless a test mocks it itself.
jest.mock("@react-native-community/netinfo", () => require("@react-native-community/netinfo/jest/netinfo-mock.js"));
