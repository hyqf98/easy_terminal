import { invoke } from '@tauri-apps/api/core';
import type { CommandConfig, CommandSummaryPage, CommandDetail, CommandLibraryPayload, CommandPayload, CommandQueryParams, CommandSearchParams } from '../../types';

export const dbService = {
  listCommandLibraries: () =>
    invoke<CommandConfig[]>('list_command_libraries'),

  searchCommandSummaries: (params: CommandSearchParams) =>
    invoke<CommandSummaryPage>('search_command_summaries', { params }),

  getCommandDetail: (libraryId: string, commandId: number) =>
    invoke<CommandDetail>('get_command_detail', { libraryId, commandId }),

  queryCommands: (params: CommandQueryParams) =>
    invoke<CommandSummaryPage>('query_commands', { params }),

  createCommand: (payload: CommandPayload) =>
    invoke('create_command', { payload }),

  updateCommand: (payload: CommandPayload) =>
    invoke('update_command', { payload }),

  deleteCommand: (libraryId: string, commandId: number) =>
    invoke('delete_command', { libraryId, commandId }),

  createCommandLibrary: (payload: CommandLibraryPayload) =>
    invoke('create_command_library', { payload }),

  deleteCommandLibrary: (libraryId: string) =>
    invoke('delete_command_library', { libraryId }),

  importCommandLibrary: (config: CommandConfig) =>
    invoke('import_command_library', { config }),

  enableCommandLibrary: (libraryId: string, enabled: boolean) =>
    invoke('enable_command_library', { libraryId, enabled }),
};
