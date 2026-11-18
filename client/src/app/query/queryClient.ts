import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000, // 1 min before a query is considered stale
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
