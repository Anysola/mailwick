import { HttpError, json, route, str } from "@/lib/api";
import { createFolder, deleteFolder, emptyFolder, getFolders, markFolderRead, renameFolder } from "@/lib/mail";

export const GET = route(async (_req, s) => json({ folders: await getFolders(s) }));

export const POST = route(async (req, s) => {
  const b = await req.json();
  switch (b?.action) {
    case "create":
      return json(await createFolder(s, str(b.name, 200), b.parent ? str(b.parent, 500) : undefined));
    case "rename":
      return json(await renameFolder(s, str(b.path, 500), str(b.name, 200)));
    case "delete":
      return json(await deleteFolder(s, str(b.path, 500)));
    case "empty":
      return json(await emptyFolder(s, str(b.path, 500)));
    case "readAll":
      return json(await markFolderRead(s, str(b.path, 500)));
    default:
      throw new HttpError(400, "errors.badAction");
  }
});
