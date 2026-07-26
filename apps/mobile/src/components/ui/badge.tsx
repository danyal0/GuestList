import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, useTheme } from '@/lib/theme';

export function Badge({
  label,
  tone = 'accent',
  style,
}: {
  label: string;
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'neutral';
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const toneColor =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : tone === 'danger'
          ? colors.danger
          : tone === 'neutral'
            ? colors.inkSecondary
            : colors.accent;

  return (
    <View
      style={[
        {
          alignSelf: 'flex-start',
          backgroundColor: tone === 'neutral' ? colors.surface3 : `${toneColor}22`,
          borderRadius: radius.full,
          paddingHorizontal: 10,
          paddingVertical: 3,
        },
        style,
      ]}
    >
      <Text style={{ color: tone === 'neutral' ? colors.inkSecondary : toneColor, fontSize: 12, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}
