import * as React from 'react';
import { useColorScheme } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { bootstrapSession } from '@/lib/api';
import { palette } from '@/lib/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

export default function RootLayout() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = palette[scheme];

  React.useEffect(() => {
    void bootstrapSession();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.ink,
            headerTitleStyle: { fontWeight: '700' },
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ presentation: 'modal', title: 'Sign in' }} />
          <Stack.Screen name="signup" options={{ presentation: 'modal', title: 'Join MKE Plays' }} />
          <Stack.Screen name="group/[slug]" options={{ title: 'Community' }} />
          <Stack.Screen name="event/[id]" options={{ title: 'Event' }} />
          <Stack.Screen name="conversation/[id]" options={{ title: 'Conversation' }} />
          <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="search" options={{ title: 'Search' }} />
          <Stack.Screen name="user/[id]" options={{ title: 'Profile' }} />
        </Stack>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
