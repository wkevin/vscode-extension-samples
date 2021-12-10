import * as vscode from 'vscode';
// ftp(https://www.npmjs.com/package/ftp) 使用方法可以看 node_modules/ftp/README.md
import * as Client from 'ftp';
import { basename, dirname, join } from 'path';

interface IEntry {
	name: string;
	type: string;
}

export interface FtpNode {

	resource: vscode.Uri;
	isDirectory: boolean;

}

export class FtpModel {
	constructor(readonly host: string, readonly port: number, private user: string, private password: string) {
	}

	// ???: Thenable<Client> 中的 Client 根据什么定位到 const client 变量的？
	// 如果是 client（首字母小写）我还能理解，但大写了，谁来判断 client 就是要返回的 Client 呢？
	// 并且有些情况 Promise 中没有变量的定义，真不知道是根据什么来定义 Promise 中唯一的值的。
	// 答：
	// 上面理解有误，c(client) 直接向后面的 p.then(client =>{...}) 传递了 client
	public connect(): Thenable<Client> {
		return new Promise((c, e) => {
			const client = new Client();
			client.on('ready', () => {
				// Promise 的精髓在于：不光返回给你 client，而是要放在你的 c() 里；即：不光返回值，还要喂到嘴里。
				c(client);
			});

			client.on('error', error => {
				e('Error while connecting: ' + error.message);
			});

			client.connect({
				host: this.host,
				port: this.port,
				user: this.user,
				password: this.password
			});
		});
	}

	// roots、connect 2个函数和2个Promise 的处理流程参见 promise.drawio
	public get roots(): Thenable<FtpNode[]> {
		const p = this.connect();
		return p.then(
			client => {  // 如何能确认这个 client 就是前面的 const client 呢？—— c(client) 而来，不需要啥确认
				return new Promise((c, e) => {
					client.list((err, list) => {
						if (err) {
							return e(err);
						}

						client.end();

						// 去掉 return 也没啥问题
						// 新建 Promise 中的 return 有什么特殊的用途么？东西都喂到 c() 的嘴里了，调用者 then 就能吃到了，还 return 给谁呢？
						// 给创建该 Promise 的进程？所以给不给都行吧——我猜！
						return c(this.sort(list.map(entry => ({ resource: vscode.Uri.parse(`ftp://${this.host}///${entry.name}`), isDirectory: entry.type === 'd' }))));
					});
				});
			},
			err => { // err 字符串从 e('Error while connecting: ' + error.message); 而来
				console.log(err);
			}
		);
	}

	public getChildren(node: FtpNode): Thenable<FtpNode[]> {
		return this.connect().then(client => {
			return new Promise((c, e) => {
				// WTF：
				// node_modules/ftp/README.md 中对 client.list 的定义：
				// list([< string >path, ][< boolean >useCompression, ]< function >callback)
				// path 和 useCompression 是可选的，难道 js 中可选的入参就这样直接忽略了？——WTF！
				// callback 必选，但也没说是 Promise 啊 —— WTF！
				client.list(node.resource.fsPath, (err, list) => {
					if (err) {
						return e(err);
					}

					client.end();

					return c(this.sort(list.map(entry => ({ resource: vscode.Uri.parse(`${node.resource.fsPath}/${entry.name}`), isDirectory: entry.type === 'd' }))));
				});
			});
		});
	}

	private sort(nodes: FtpNode[]): FtpNode[] {
		return nodes.sort((n1, n2) => {
			if (n1.isDirectory && !n2.isDirectory) {
				return -1;
			}

			if (!n1.isDirectory && n2.isDirectory) {
				return 1;
			}

			return basename(n1.resource.fsPath).localeCompare(basename(n2.resource.fsPath));
		});
	}

	public getContent(resource: vscode.Uri): Thenable<string> {
		return this.connect().then(client => {
			return new Promise((c, e) => {
				client.get(resource.path.substr(2), (err, stream) => {
					if (err) {
						return e(err);
					}

					let string = '';
					stream.on('data', function (buffer) {
						if (buffer) {
							const part = buffer.toString();
							string += part;
						}
					});

					stream.on('end', function () {
						client.end();
						c(string);
					});
				});
			});
		});
	}
}

/**
 * 继承自 2 个 interface
 * TextDocumentContentProvider：为 editor 提供一个只读的文档，需实现 provideTextDocumentContent(文件类型...)
 */
export class FtpTreeDataProvider implements vscode.TreeDataProvider<FtpNode>, vscode.TextDocumentContentProvider {

	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

	constructor(private readonly model: FtpModel) { }

	public refresh(): any {
		this._onDidChangeTreeData.fire(undefined);
	}


	public getTreeItem(element: FtpNode): vscode.TreeItem {
		return {
			resourceUri: element.resource,
			collapsibleState: element.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : void 0,
			command: element.isDirectory ? void 0 : {
				command: 'ftpExplorer.openFtpResource', // 为 item 添加一个点击会触发的命令
				arguments: [element.resource],
				title: 'Open FTP Resource'
			}
		};
	}

	public getChildren(element?: FtpNode): FtpNode[] | Thenable<FtpNode[]> {
		return element ? this.model.getChildren(element) : this.model.roots;
	}

	public getParent(element: FtpNode): FtpNode {
		const parent = element.resource.with({ path: dirname(element.resource.path) });
		return parent.path !== '//' ? { resource: parent, isDirectory: true } : null;
	}

	public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
		return this.model.getContent(uri).then(content => content);
	}
}

export class FtpExplorer {

	private ftpViewer: vscode.TreeView<FtpNode>;

	constructor(context: vscode.ExtensionContext) {
		/* Please note that login information is hardcoded only for this example purpose and recommended not to do it in general. */
		const ftpModel = new FtpModel('127.0.0.1', 2121, '123', '321');
		const treeDataProvider = new FtpTreeDataProvider(ftpModel);
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('ftp', treeDataProvider));

		this.ftpViewer = vscode.window.createTreeView('ftpExplorer', { treeDataProvider });

		vscode.commands.registerCommand('ftpExplorer.refresh', () => treeDataProvider.refresh());
		vscode.commands.registerCommand('ftpExplorer.openFtpResource', resource => this.openResource(resource));
		vscode.commands.registerCommand('ftpExplorer.revealResource', () => this.reveal());
	}

	private openResource(resource: vscode.Uri): void {
		vscode.window.showTextDocument(resource);
	}

	private reveal(): Thenable<void> {
		const node = this.getNode();
		if (node) {
			return this.ftpViewer.reveal(node);
		}
		return null;
	}

	private getNode(): FtpNode {
		if (vscode.window.activeTextEditor) {
			if (vscode.window.activeTextEditor.document.uri.scheme === 'ftp') {
				return { resource: vscode.window.activeTextEditor.document.uri, isDirectory: false };
			}
		}
		return null;
	}
}