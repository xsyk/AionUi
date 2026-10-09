/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { isBackendHttpError } from '@/common/adapter/httpBridge';
import { imageGeneration } from '@/common/adapter/ipcBridge';
import type { ImageGenerationSettings, ImageGenerationSettingsUpdate } from '@/common/config/clientSettings';
import type { IMcpServer } from '@/common/config/storage';
import { isImageGenSupported } from '@/common/utils/imageModelAllowlist';
import { Alert, Divider, Form, Tooltip, Message, Modal, Switch } from '@arco-design/web-react';
import { Help } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import useConfigModelListWithImage from '@/renderer/hooks/agent/useConfigModelListWithImage';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import AionSelect from '@/renderer/components/base/AionSelect';
import TalkToButlerButton from '@/renderer/components/base/TalkToButlerButton';
import SharedConfigNotice from '@/renderer/components/settings/SettingsModal/SharedConfigNotice';
import AddMcpServerModal from '@/renderer/pages/settings/components/AddMcpServerModal';
import McpServerItem from '@/renderer/pages/settings/ToolsSettings/McpServerItem';
import { useCanManageSharedConfig } from '@/renderer/hooks/context/useCanManageSharedConfig';
import {
  useMcpServers,
  useMcpConnection,
  useMcpModal,
  useMcpServerCRUD,
  useMcpOAuth,
  useMountedMessage,
} from '@/renderer/hooks/mcp';
import { isBuiltinImageGenServer } from '@/renderer/hooks/mcp/catalog';
import classNames from 'classnames';
import { useSettingsTabNavigate, useSettingsViewMode } from '../settingsViewContext';

type MessageInstance = ReturnType<typeof Message.useMessage>[0];

const ModalMcpManagementSection: React.FC<{
  message: MessageInstance;
  mcpServers: IMcpServer[];
  extensionMcpServers: IMcpServer[];
  setMcpServers: React.Dispatch<React.SetStateAction<IMcpServer[]>>;
  saveMcpServers: (serversOrUpdater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => Promise<void>;
  isPageMode?: boolean;
}> = ({ message, mcpServers, extensionMcpServers, setMcpServers, saveMcpServers, isPageMode }) => {
  const { t } = useTranslation();
  const { oauthStatus, loggingIn, checkOAuthStatus, markLoginRequired, clearLoginRequired, login } = useMcpOAuth();
  const visibleMcpServers = useMemo(
    () => mcpServers.filter((server) => !isBuiltinImageGenServer(server)),
    [mcpServers]
  );

  const handleAuthRequired = useCallback(
    (server: IMcpServer) => {
      markLoginRequired(server.id);
    },
    [markLoginRequired]
  );
  const handleAuthResolved = useCallback(
    (server: IMcpServer) => {
      clearLoginRequired(server.id);
    },
    [clearLoginRequired]
  );

  const { testingServers, handleTestMcpConnection, handleTestMcpConnections } = useMcpConnection(
    setMcpServers,
    message,
    handleAuthRequired,
    handleAuthResolved
  );
  const {
    showMcpModal,
    editingMcpServer,
    deleteConfirmVisible,
    serverToDelete,
    mcpCollapseKey,
    showAddMcpModal,
    showEditMcpModal,
    hideMcpModal,
    showDeleteConfirm,
    hideDeleteConfirm,
    toggleServerCollapse,
  } = useMcpModal();
  const { handleAddMcpServer, handleBatchImportMcpServers, handleEditMcpServer, handleDeleteMcpServer } =
    useMcpServerCRUD(saveMcpServers);

  const handleOAuthLogin = useCallback(
    async (server: IMcpServer) => {
      const result = await login(server);

      if (result.success) {
        message.success(`${server.name}: ${t('settings.mcpOAuthLoginSuccess') || 'Login successful'}`);
        void handleTestMcpConnection(server);
      } else {
        message.error(`${server.name}: ${result.error || t('settings.mcpOAuthLoginFailed') || 'Login failed'}`);
      }
    },
    [login, message, t, handleTestMcpConnection]
  );

  const wrappedHandleAddMcpServer = useCallback(
    async (serverData: Omit<IMcpServer, 'id' | 'created_at' | 'updated_at'>) => {
      const addedServer = await handleAddMcpServer(serverData);
      if (addedServer) {
        void handleTestMcpConnection(addedServer, { notify: false });
      }
    },
    [handleAddMcpServer, handleTestMcpConnection]
  );

  const wrappedHandleEditMcpServer = useCallback(
    async (serverToEdit: IMcpServer | undefined, serverData: Omit<IMcpServer, 'id' | 'created_at' | 'updated_at'>) => {
      const updatedServer = await handleEditMcpServer(serverToEdit, serverData);
      if (updatedServer) {
        void handleTestMcpConnection(updatedServer, { notify: false });
      }
    },
    [handleEditMcpServer, handleTestMcpConnection]
  );

  const wrappedHandleBatchImportMcpServers = useCallback(
    async (serversData: Omit<IMcpServer, 'id' | 'created_at' | 'updated_at'>[]) => {
      const addedServers = await handleBatchImportMcpServers(serversData);
      if (addedServers && addedServers.length > 0) {
        await handleTestMcpConnections(addedServers, { concurrency: 4, notify: false });
      }
      return addedServers;
    },
    [handleBatchImportMcpServers, handleTestMcpConnections]
  );

  const [importMode, setImportMode] = useState<'json' | 'oneclick'>('json');

  useEffect(() => {
    const httpServers = mcpServers.filter(
      (s) => s.transport.type === 'http' || s.transport.type === 'sse' || s.transport.type === 'streamable_http'
    );
    if (httpServers.length > 0) {
      httpServers.forEach((server) => {
        void checkOAuthStatus(server);
      });
    }
  }, [mcpServers, checkOAuthStatus]);

  const handleConfirmDelete = useCallback(async () => {
    if (!serverToDelete) return;
    hideDeleteConfirm();
    await handleDeleteMcpServer(serverToDelete);
  }, [serverToDelete, hideDeleteConfirm, handleDeleteMcpServer]);

  const renderAddButton = () => {
    return (
      <TalkToButlerButton
        label={t('settings.mcpAddServer')}
        chatLabel={t('settings.talkToButler.addViaChat', { defaultValue: 'Add via chat' })}
        prompt={t('settings.talkToButler.prompt.addMcp', { defaultValue: 'Help me set up an MCP server.' })}
        extraActions={[
          {
            key: 'json',
            label: t('settings.mcpImportFromJSON'),
            onClick: () => {
              setImportMode('json');
              showAddMcpModal();
            },
          },
          {
            key: 'oneclick',
            label: t('settings.mcpOneKeyImport'),
            onClick: () => {
              setImportMode('oneclick');
              showAddMcpModal();
            },
          },
        ]}
      />
    );
  };

  return (
    <div className='flex flex-col gap-16px min-h-0'>
      <div className='flex gap-8px items-center justify-between'>
        <div className='text-14px text-t-primary'>{t('settings.mcpSettings')}</div>
        <div>{renderAddButton()}</div>
      </div>

      <div className='flex-1 min-h-0'>
        {visibleMcpServers.length === 0 && extensionMcpServers.length === 0 ? (
          <div className='py-24px text-center text-t-secondary text-14px border border-dashed border-border-2 rd-12px'>
            {t('settings.mcpNoServersFound')}
          </div>
        ) : (
          <AionScrollArea
            className={classNames('max-h-360px', isPageMode && 'max-h-none')}
            disableOverflow={isPageMode}
          >
            <div className='space-y-12px'>
              {visibleMcpServers.map((server) => (
                <McpServerItem
                  key={server.id}
                  server={server}
                  isCollapsed={mcpCollapseKey[server.id] || false}
                  isTestingConnection={testingServers[server.id] || false}
                  oauthStatus={oauthStatus[server.id]}
                  isLoggingIn={loggingIn[server.id]}
                  onToggleCollapse={() => toggleServerCollapse(server.id)}
                  onTestConnection={handleTestMcpConnection}
                  onEditServer={showEditMcpModal}
                  onDeleteServer={showDeleteConfirm}
                  onOAuthLogin={handleOAuthLogin}
                />
              ))}
              {extensionMcpServers.map((server) => (
                <McpServerItem
                  key={server.id}
                  server={server}
                  isCollapsed={mcpCollapseKey[server.id] || false}
                  isTestingConnection={false}
                  onToggleCollapse={() => toggleServerCollapse(server.id)}
                  onTestConnection={handleTestMcpConnection}
                  onEditServer={() => {}}
                  onDeleteServer={() => {}}
                  isReadOnly
                />
              ))}
            </div>
          </AionScrollArea>
        )}
      </div>

      <AddMcpServerModal
        visible={showMcpModal}
        server={editingMcpServer}
        existingServerNames={mcpServers.map((server) => server.name)}
        onCancel={hideMcpModal}
        onSubmit={
          editingMcpServer
            ? (serverData) => wrappedHandleEditMcpServer(editingMcpServer, serverData)
            : wrappedHandleAddMcpServer
        }
        onBatchImport={wrappedHandleBatchImportMcpServers}
        importMode={importMode}
      />

      <Modal
        title={t('settings.mcpDeleteServer')}
        visible={deleteConfirmVisible}
        onCancel={hideDeleteConfirm}
        onOk={handleConfirmDelete}
        okButtonProps={{ status: 'danger' }}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
      >
        <p>{t('settings.mcpDeleteConfirm')}</p>
      </Modal>
    </div>
  );
};

const IMAGE_GENERATION_SWR_KEY = 'settings.imageGeneration';

// Arco's Alert puts role="alert" on its root, which screen readers announce assertively, but lets any extra prop
// override it (AlertProps just does not declare `role`, hence the spread). This hint is static, so it is a status.
const STATUS_ROLE_PROPS = { role: 'status' };

const toModelOptionValue = (providerId: string, model: string) => `${providerId}|${model}`;

/** Why the backend refused a save. A 400 carries the reason (unknown provider, model not offered, ...). */
const getSaveRefusal = (error: unknown): string | undefined =>
  isBackendHttpError(error) && error.status === 400 && error.backendMessage.trim() ? error.backendMessage : undefined;

/**
 * The image generation model. It is one setting for the whole server: the administrator chooses it and the
 * backend adds the image generation MCP server to every session itself, so this section only reads and writes
 * /api/settings/image-generation. Nothing here touches a per-user preference or a per-user MCP row.
 */
const ImageGenerationSection: React.FC<{ message: MessageInstance }> = ({ message }) => {
  const { t } = useTranslation();
  const canManage = useCanManageSharedConfig();
  const navigateToSettingsTab = useSettingsTabNavigate();
  const { modelListWithImage: data } = useConfigModelListWithImage();
  const {
    data: settings,
    isLoading,
    mutate,
  } = useSWR<ImageGenerationSettings>(IMAGE_GENERATION_SWR_KEY, () => imageGeneration.get.invoke());
  const [isSaving, setIsSaving] = useState(false);

  // Providers that offer at least one image model the generation tool can use, with only those models.
  const imageGenerationModelList = useMemo(
    () =>
      (data ?? []).flatMap((provider) => {
        const models = provider.models.filter((modelName) => isImageGenSupported(provider, modelName));
        return models.length > 0 ? [{ id: provider.id, name: provider.name, models }] : [];
      }),
    [data]
  );

  const save = useCallback(
    async (update: ImageGenerationSettingsUpdate) => {
      setIsSaving(true);
      try {
        await mutate(await imageGeneration.update.invoke(update), { revalidate: false });
      } catch (error) {
        console.error('[ImageGen] Failed to save the shared image generation setting:', error);
        message.error(getSaveRefusal(error) ?? t('common.saveFailed'));
        // A refusal can mean the server moved on (another admin, a deleted provider): show where it stands.
        void mutate();
      } finally {
        setIsSaving(false);
      }
    },
    [message, mutate, t]
  );

  const handleModelChange = useCallback(
    (value: string) => {
      if (!canManage || !settings) return;
      for (const provider of imageGenerationModelList) {
        const model = provider.models.find((modelName) => toModelOptionValue(provider.id, modelName) === value);
        if (model !== undefined) {
          // Picking a model never switches the tool on or off by itself.
          void save({ provider_id: provider.id, model, enabled: settings.enabled });
          return;
        }
      }
    },
    [canManage, imageGenerationModelList, save, settings]
  );

  const handleToggle = useCallback(
    (checked: boolean) => {
      if (!canManage || !settings) return;
      void save({ provider_id: settings.provider_id, model: settings.model, enabled: checked });
    },
    [canManage, save, settings]
  );

  // Until the server has answered nothing is known, so nothing is claimed missing.
  const isSupported = settings?.supported !== false;
  const hasModel = Boolean(settings?.provider_id && settings.model);
  // Only the administrator can change it, and not while it is unknown, being saved, or unable to run here.
  const isLocked = !canManage || !settings || isSaving || !isSupported;
  // Turning it on needs a model; turning it off is always possible.
  const isSwitchDisabled = isLocked || (!settings?.enabled && !hasModel);
  const selectedValue =
    settings?.provider_id && settings.model ? toModelOptionValue(settings.provider_id, settings.model) : undefined;

  return (
    <div className='px-[12px] md:px-[32px] py-[24px] bg-2 rd-12px md:rd-16px border border-border-2 flex flex-col gap-16px'>
      <div className='flex items-center justify-between'>
        <span className='text-14px text-t-primary'>{t('settings.imageGeneration')}</span>
        <Switch
          data-testid='image-generation-switch'
          aria-label={t('settings.imageGeneration')}
          disabled={isSwitchDisabled}
          checked={Boolean(settings?.enabled) && isSupported}
          loading={isLoading}
          onChange={handleToggle}
        />
      </div>

      <SharedConfigNotice
        canManage={canManage}
        adminText={t('settings.sharedConfig.imageAdmin')}
        readonlyText={t('settings.sharedConfig.imageReadonly')}
      />
      {settings?.supported === false && (
        <Alert
          type='warning'
          {...STATUS_ROLE_PROPS}
          content={t('settings.sharedConfig.imageUnsupported')}
          className='!rounded-8px'
          data-testid='image-generation-unsupported'
        />
      )}

      <Divider className='!my-0' />

      <Form layout='horizontal' labelAlign='left' className='space-y-12px'>
        <Form.Item
          label={t('settings.imageGenerationModel')}
          tooltip={
            <div className='space-y-4px'>
              <div>{t('settings.imageGenSupportedTooltipTitle')}</div>
              <ul className='list-disc ps-16px m-0'>
                <li>{t('settings.imageGenSupportedTooltipGemini')}</li>
                <li>{t('settings.imageGenSupportedTooltipOpenRouter')}</li>
                <li>{t('settings.imageGenSupportedTooltipAntigravity')}</li>
              </ul>
              <div>{t('settings.imageGenUnsupportedTooltip')}</div>
            </div>
          }
        >
          {imageGenerationModelList.length > 0 ? (
            <AionSelect
              value={selectedValue}
              disabled={isLocked}
              // The saved choice can name a model the list no longer offers (its provider was removed or
              // changed); show the model name rather than the raw "provider|model" value.
              renderFormat={(option) => option?.children ?? settings?.model}
              onChange={handleModelChange}
            >
              {imageGenerationModelList.map(({ id, name, models }) => (
                <AionSelect.OptGroup label={name} key={id}>
                  {models.map((modelName) => (
                    <AionSelect.Option key={id + modelName} value={toModelOptionValue(id, modelName)}>
                      {modelName}
                    </AionSelect.Option>
                  ))}
                </AionSelect.OptGroup>
              ))}
            </AionSelect>
          ) : (
            <div className='text-t-secondary flex items-center'>
              {t('settings.noAvailable')}
              {/* Models are added by the administrator; for everyone else there is nothing to go and configure. */}
              {canManage &&
                (navigateToSettingsTab ? (
                  <a
                    className='text-inherit underline underline-offset-2 cursor-pointer'
                    onClick={() => navigateToSettingsTab('model')}
                  >
                    {t('settings.goToModelSettings')}
                  </a>
                ) : (
                  t('settings.goToModelSettings')
                ))}
              {canManage && (
                <Tooltip
                  content={
                    <div>
                      {t('settings.needHelpTooltip')}
                      <a
                        href='https://github.com/iOfficeAI/AionUi/wiki/AionUi-Image-Generation-Tool-Model-Configuration-Guide'
                        target='_blank'
                        rel='noopener noreferrer'
                        className='text-[rgb(var(--primary-6))] hover:text-[rgb(var(--primary-5))] underline ms-4px'
                        onClick={(e) => e.stopPropagation()}
                      >
                        {t('settings.configGuide')}
                      </a>
                    </div>
                  }
                >
                  <a
                    href='https://github.com/iOfficeAI/AionUi/wiki/AionUi-Image-Generation-Tool-Model-Configuration-Guide'
                    target='_blank'
                    rel='noopener noreferrer'
                    className='ms-8px text-[rgb(var(--primary-6))] hover:text-[rgb(var(--primary-5))] cursor-pointer'
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Help theme='outline' size='14' />
                  </a>
                </Tooltip>
              )}
            </div>
          )}
        </Form.Item>
      </Form>
    </div>
  );
};

const ToolsModalContent: React.FC = () => {
  const [rawMcpMessage, mcpMessageContext] = Message.useMessage({ maxCount: 10 });
  // ELECTRON-1A1: guard message calls so async MCP callbacks that resolve after this
  // component unmounts don't hit a null Arco context holder (null.addInstance crash).
  const mcpMessage = useMountedMessage(rawMcpMessage);
  const { mcpServers, extensionMcpServers, saveMcpServers, setMcpServers } = useMcpServers();

  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  return (
    <div className='flex flex-col h-full w-full'>
      {mcpMessageContext}

      {/* Content Area */}
      <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
        <div className='space-y-16px'>
          {/* MCP 工具配置 */}
          <div className='px-[12px] md:px-[32px] py-[24px] bg-2 rd-12px md:rd-16px flex flex-col min-h-0 border border-border-2'>
            <div className='flex-1 min-h-0'>
              <AionScrollArea
                className={classNames('h-full', isPageMode && 'overflow-visible')}
                disableOverflow={isPageMode}
              >
                <ModalMcpManagementSection
                  message={mcpMessage}
                  mcpServers={mcpServers}
                  extensionMcpServers={extensionMcpServers}
                  setMcpServers={setMcpServers}
                  saveMcpServers={saveMcpServers}
                  isPageMode={isPageMode}
                />
              </AionScrollArea>
            </div>
          </div>
          {/* 图像生成 */}
          <ImageGenerationSection message={mcpMessage} />
        </div>
      </AionScrollArea>
    </div>
  );
};

export default ToolsModalContent;
