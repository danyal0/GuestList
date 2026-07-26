import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { absoluteUrl } from '@/lib/api';
import { initials } from '@/lib/format';
import { useTheme } from '@/lib/theme';

export function Avatar({
  uri,
  name,
  size = 40,
}: {
  uri: string | null | undefined;
  name: string;
  size?: number;
}) {
  const { colors } = useTheme();
  const resolved = absoluteUrl(uri ?? null);

  if (resolved) {
    return (
      <Image
        source={{ uri: resolved }}
        accessibilityLabel={name}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surface2 }}
        contentFit="cover"
        transition={150}
      />
    );
  }
  return (
    <View
      accessibilityLabel={name}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.accentSoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.accent, fontWeight: '700', fontSize: size * 0.38 }}>
        {initials(name)}
      </Text>
    </View>
  );
}
