import * as React from 'react';
import { type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { radius, useTheme } from '@/lib/theme';

export function Skeleton({
  width = '100%',
  height = 16,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const opacity = useSharedValue(0.5);

  React.useEffect(() => {
    opacity.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      style={[
        { width, height, borderRadius: radius.sm, backgroundColor: colors.surface3 },
        animatedStyle,
        style,
      ]}
    />
  );
}
