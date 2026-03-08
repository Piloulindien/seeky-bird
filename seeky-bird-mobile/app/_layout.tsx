import React from 'react'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { AppProviders } from '@/components/app-providers'

export default function RootLayout() {
  return (
    <AppProviders>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }} />
    </AppProviders>
  )
}
