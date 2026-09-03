import { configureStore } from '@reduxjs/toolkit'
import { rpcApi } from '@/services/rpcApi'
import connectionReducer from '@/features/connection/connectionSlice'
import uiReducer from '@/features/ui/uiSlice'
import workspaceReducer, { persistWorkspaceMiddleware } from '@/features/workspace/workspaceSlice'
import speedHistoryReducer, { speedSamplerMiddleware } from '@/features/stats/speedHistorySlice'
import { completionNotifierMiddleware } from '@/features/torrents/completions'
import { actionErrorMiddleware } from '@/features/ui/actionErrors'

export const store = configureStore({
  reducer: {
    [rpcApi.reducerPath]: rpcApi.reducer,
    connection: connectionReducer,
    ui: uiReducer,
    workspace: workspaceReducer,
    speedHistory: speedHistoryReducer
  },
  middleware: (getDefault) =>
    getDefault()
      .prepend(
        persistWorkspaceMiddleware.middleware,
        speedSamplerMiddleware.middleware,
        completionNotifierMiddleware.middleware,
        actionErrorMiddleware.middleware
      )
      .concat(rpcApi.middleware)
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
