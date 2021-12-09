import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class DepNodeProvider implements vscode.TreeDataProvider<Dependency> {

	// 此 event 是本 class 发出，vscode 注册回调函数，并在本 event.fire 的时候执行回调
	// 这是 provider 向 view 发送命令
	private _onDidChangeTreeData: vscode.EventEmitter<Dependency | undefined | void> = new vscode.EventEmitter<Dependency | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<Dependency | undefined | void> = this._onDidChangeTreeData.event;

	constructor(private workspaceRoot: string | undefined) {
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	// TreeDataProvider 可以实现的函数有下面4个，这是 view 向 provider 发出命令：
	// 		getTreeItem: vscode 需要某个指定 element 的 TreeItem 的时候调用此函数，返回一个节点
	// 		getChildren: vscode 需要某个指定 element 的 children 的时候调用此函数，返回节点数组
	// 		getParent: 同上理，返回节点数组
	// 		resolveTreeItem: 鼠标停留或单击时，需要解析某个 item 时调用
	getTreeItem(element: Dependency): vscode.TreeItem {
		return element;
	}

	// TreeDataProvider 接口的 getChildren 原型返回值是：
	// export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;
	getChildren(element?: Dependency): Thenable<Dependency[]> {

		/**
		 * Promise 对象代表一个异步操作，有三种状态：
		 * 	1. Pending（进行中）
		 * 	2. Resolved（已完成，又称 Fulfilled）
		 * 	3. Rejected（已失败）
		 * 
		 * Promise 还有1个 Value，一旦设置了值，就无法更改它。
		 * 
		 * Promise.resolve()
		 * 参数分成四种情况:
		 * 	1. 参数是一个 Promise 实例: Promise.resolve 将不做任何修改、原封不动地返回这个实例。
		 * 	2. 参数是一个 thenable 对象: 将这个对象转为 Promise 对象，然后就立即执行thenable对象的then方法。
		 * 			thenable 是具有 then() 的对象。
		 * 			promise 调用 then 的前提是 promise 的状态为 Resolved(fullfilled)；
		 * 			只有 promise 调用 then 的时候，then 里面的函数才会被推入任务队列；
		 * 			队列中的函数在本轮“事件循环”（event loop）的结束时执行，而不是在下一轮“事件循环”的开始时。
		 * 	3. 参数是没有 then 方法的对象，或根本就不是对象: 返回一个新的 Promise 对象，状态为 resolved 。
		 * 	4. 不带有任何参数: 返回一个 resolved 状态的 Promise void 对象。
		 * 
		 * resolve()本质作用是把 promise 的状态标记为 Resolved(fullfilled)，
		 * 但也不过只是定义了一个有状态的 Promise，并没有调用它；
		 */

		if (!this.workspaceRoot) {
			vscode.window.showInformationMessage('No dependency in empty workspace');
			return Promise.resolve([]);
		}

		if (element) {
			return Promise.resolve(this.getDepsInPackageJson(path.join(this.workspaceRoot, 'node_modules', element.label, 'package.json')));
		} else {
			// 寻找 package.json 文件
			const packageJsonPath = path.join(this.workspaceRoot, 'package.json');
			if (this.pathExists(packageJsonPath)) {
				// 如果文件存在，则根据其中的 dependency 项生成 TreeItem 的 chrildren
				return Promise.resolve(this.getDepsInPackageJson(packageJsonPath));
			} else {
				vscode.window.showInformationMessage('Workspace has no package.json');
				return Promise.resolve([]);
			}
		}

	}

	/**
	 * Given the path to package.json, read all its dependencies and devDependencies.
	 */
	private getDepsInPackageJson(packageJsonPath: string): Dependency[] {
		if (this.pathExists(packageJsonPath)) {
			// 读取 json 文件内容
			const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

			// 定义从 json 节点生成 item 的函数
			const toDep = (moduleName: string, version: string): Dependency => {
				if (this.pathExists(path.join(this.workspaceRoot, 'node_modules', moduleName))) {
					// 如果工作路径下的 node_modules 中能够找到该 module，生成一个可折叠的模块
					return new Dependency(moduleName, version, vscode.TreeItemCollapsibleState.Collapsed);
				} else {
					// 否则，该 module 只在 json 文件中出现，并未安装到当前目录下，则生成不可折叠项 item
					// 并且添加“点击跳转到 npm 网址相应包地址”的命令
					return new Dependency(moduleName, version, vscode.TreeItemCollapsibleState.None, {
						command: 'extension.openPackageOnNpm',
						title: '',
						arguments: [moduleName]
					});
				}
			};

			// packageJson.dependencies 是个 object，但很像是个字典，有 key:value
			// Object.keys(packageJson.dependencies) 提取包名
			const deps = packageJson.dependencies
				? Object.keys(packageJson.dependencies).map(dep => toDep(dep, packageJson.dependencies[dep]))
				: [];
			const devDeps = packageJson.devDependencies
				? Object.keys(packageJson.devDependencies).map(dep => toDep(dep, packageJson.devDependencies[dep]))
				: [];
			// 最终返回 item 的 array
			return deps.concat(devDeps);
		} else {
			return [];
		}
	}

	private pathExists(p: string): boolean {
		try {
			fs.accessSync(p);
		} catch (err) {
			return false;
		}

		return true;
	}
}

export class Dependency extends vscode.TreeItem {
	// TreeItem 类有如下变量：
	// label, id, iconPath, description, resourceUri, tooltip, 
	// command, collapsibleState,  contextValue, accessibilityInformation
	// 
	// 但 TreeItem 的构造函数仅接受 label, collapsibleState 2个入参 
	// 靠继承类的构造函数向父类的变量直接赋值 —— 真是神奇的语法
	constructor(
		public readonly label: string,
		private readonly version: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
	) {
		super(label, collapsibleState);

		this.tooltip = `${this.label}-${this.version}`;
		this.description = this.version;
	}

	iconPath = {
		light: path.join(__filename, '..', '..', 'resources', 'light', 'dependency.svg'),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', 'dependency.svg')
	};

	contextValue = 'dependency';
}
