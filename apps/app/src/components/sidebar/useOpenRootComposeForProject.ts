import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import { getRootComposeRoutePath } from "@/lib/route-paths";

/** Native sidebar project action that opens the root composer in one project. */
export function useOpenRootComposeForProject(onNavigate?: () => void) {
  const navigate = useNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();

  return useCallback(
    (projectId: string, sectionId?: string) => {
      setRootComposeProjectId(projectId);
      onNavigate?.();
      void navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: true,
          ...(sectionId ? { sectionId } : {}),
        },
      });
    },
    [navigate, onNavigate, setRootComposeProjectId],
  );
}
