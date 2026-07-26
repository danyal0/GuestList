import * as React from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';
import { radius, spacing, useTheme } from '@/lib/theme';

export interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string;
}

export const TextField = React.forwardRef<TextInput, TextFieldProps>(
  ({ label, error, style, ...props }, ref) => {
    const { colors } = useTheme();
    const [focused, setFocused] = React.useState(false);

    return (
      <View style={{ gap: 6 }}>
        <Text
          style={{
            fontSize: 13,
            fontWeight: '600',
            color: colors.inkSecondary,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
          }}
        >
          {label}
        </Text>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.inkTertiary}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={[
            {
              backgroundColor: colors.surface,
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: error ? colors.danger : focused ? colors.accent : colors.hairline,
              paddingHorizontal: spacing.lg,
              paddingVertical: 14,
              fontSize: 16,
              color: colors.ink,
            },
            style,
          ]}
          {...props}
        />
        {error && (
          <Text accessibilityRole="alert" style={{ fontSize: 13, color: colors.danger }}>
            {error}
          </Text>
        )}
      </View>
    );
  },
);
TextField.displayName = 'TextField';
