"use client";
import { Alert, Button } from "@heroui/react";
export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-6">
      <Alert status="danger">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Workspace could not be opened</Alert.Title>
          <Alert.Description>Check the server connection and try again.</Alert.Description>
        </Alert.Content>
      </Alert>
      <div>
        <Button onPress={reset}>Try again</Button>
      </div>
    </main>
  );
}
