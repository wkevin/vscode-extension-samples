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

/**
 * 本例子的关键流程
 * extension.ts 中实例化 FtpExplorer，自己完成 treeview 的创建，而不是让 vscode 根据 package.json 自动创建。
 * FtpExplorer 创建 treeview 和 provider，并且实例化 1个 FtpModel 作为 provider 构造函数的入参。
 * FtpModel 为 provider 提供数据；
 * provider 继承自2个： TreeviewProvider<FtpNode>、TextDocumentContentProvider
*/

/**
 * FtpModel 为 Provider 提供数据，主要实现了3个数据提供函数 roots、getChildren、getContent
 * 3 个数据提供函数都会在数据获取时 connect() ，获取完毕后自己关闭 ftp 连接（ client.end() )
 * 其中需要重点理解的是：Promise、Thenable<Client> 
 */
export class FtpModel {
	constructor(readonly host: string, readonly port: number, private user: string, private password: string) {
	}

	// 
	/**
	 * [Q]
	 * Thenable<Client> 中的 Client 根据什么定位到 const client 变量的？
	 * 如果是 client（首字母小写）我还能理解，但大写了，谁来判断 client 就是要返回的 Client 呢？
	 * 并且有些情况 Promise 中没有变量的定义，真不知道是根据什么来定义 Promise 中唯一的值的。
	 * [A]
	 * 上面理解有误，c(client) 直接向后面的 p.then(client =>{...}) 传递了 client
	 * 并且只表示 c() 传递的 client，不表示 e() 中传递的 string
	 * Thenable<T> 指 c(<T>) 中返回的 T
	 * @returns 
	 */
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

			/**
			 * [Q]
			 * 在这里加断点，单步执行后并不能看到 ftp server 那边的连接显示，而是在 p.then() 的时候才显示，why？
			 * 比如 下面 root() 中的：
			 * const p = this.connect();
			 * p.then(client => {...}, err => {...})
			 * ftp server 打印：[I 2022-01-10 11:12:40] 127.0.0.1:40346-[123] USER '123' logged in.
			 * 在 p.then() 之后，c(client) 及 client => {...} 之前。
			 * [A]
			 * 画了 ftpExplorer.ts-promise.drawio 感觉理解了，但仔细一想也可能还是不对，具体看图吧。
			 */
			client.connect({
				host: this.host,
				port: this.port,
				user: this.user,
				password: this.password
			});
		});
	}

	public get roots(): Thenable<FtpNode[]> {
		const p = this.connect();
		// p.then(func1, func2) 中的2个函数入参，分别对应 Promise 中的 c、e，即：用 c、e 这2张嘴吃掉传递过来的数据
		return p.then(
			client => {  // 如何能确认这个 client 就是前面的 const client 呢？—— c(client) 而来，不需要啥确认
				return new Promise((c, e) => {
					client.list((err, list) => {
						if (err) {
							return e(err);
						}

						client.end();

						// 去掉 return 这个单词也没啥问题
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
 * 继承自 2 个 interface:
 * TreeDataProvider: 需实现 getTreeItem、getChildren、getParent
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
		// 可以这样创建一个临时的 ftp server：
		// 		python -m pyftpdlib  -p 2121 -w -u 123 -P 321
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