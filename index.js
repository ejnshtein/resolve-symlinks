#!/usr/bin/env node

const chalk = require('chalk')
const Enquirer = require('enquirer')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execAsyncSpawn } = require('./lib/exec-async-command')
const pathExists = require('./lib/path-exists')

const pkgPath = path.join(process.cwd(), 'package.json')

const { Select } = Enquirer;

void async function main(){
    if (!await pathExists(pkgPath)) {
        console.error('package.json does exist!')
        return
    }

    /**
     * @type {{ dependencies: Record<string, string> }}
     */
    const pkg = JSON.parse(await fs.promises.readFile(pkgPath, 'utf-8'))

    if (!pkg.dependencies || typeof pkg.dependencies !== 'object') {
        console.error('dependencies field in package.json does not exists or is not of type Object!')
        return
    }

    if (!await pathExists(path.join(process.cwd(), 'node_modules'))) {
        console.log('Dependencies are not installed!')

        const confirmPrompt = new Select({
            message: 'Do you want to install dependencies using npm?',
            choices: [
                {
                    message: 'Yes',
                    name: 'yes'
                },
                {
                    message: 'I\'ll install them myself',
                    name: 'no'
                }
            ]
        })

        let result
        try {
        result = await confirmPrompt.run()
        } catch (e) {
            console.log('You could\'ve selected second option...')
            return
        }

        if (result === 'no') {
            console.log('OK!')
            return
        }

        await execAsyncSpawn('npm i', {
            pipeInput: true,
            pipeOutput: true
        })
    }

    const symlinkedDependencies = Object.entries(pkg.dependencies).filter(([key, value]) => value.startsWith('file:')).map(([key, value]) => {
        const splittedValue = value.split(':')
        const dependencyPath = splittedValue.pop();

        return {
            name: key,
            value,
            path: dependencyPath
        }
    })

    const missingDependencies = (
        await Promise.all(
            symlinkedDependencies.map(
                async (d) => {
                    const dependencyExists = await pathExists(path.join(process.cwd(), d.path))

                    if (!dependencyExists) {
                        return d
                    }

                    return true
                }
            )
        )
    ).filter(v => typeof v !== 'boolean')

    if (missingDependencies.length > 0) {
        missingDependencies.forEach(d => {
            console.error(`Dependency does not exist: ${d.name} -> ${d.value}`)
        })

        return
    }

    const missingInstalledDependencies = (
        await Promise.all(
            symlinkedDependencies.map(
                async (d) => {
                    const dependencyExists = await pathExists(path.join(process.cwd(), 'node_modules', d.name))

                    if (!dependencyExists) {
                        return d
                    }

                    return true
                }
            )
        )
    ).filter(v => typeof v !== 'boolean')


    if (missingInstalledDependencies.length > 0) {
        missingInstalledDependencies.forEach(d => {
            console.error(`Dependency is not installed: ${d.name}`)
        })

        return
    }

    const realPaths = await Promise.all(symlinkedDependencies.map(async (d) => {
        const dependencyPath = path.join(process.cwd(), 'node_modules', d.name)
        const dependencyExists = await pathExists(dependencyPath)

        const globalPath = path.join(os.homedir(), '.config', 'yarn', 'link', d.name)
        const globalPathExists = await pathExists(globalPath)

        if (dependencyExists) {
            const realPath = await fs.promises.realpath(dependencyPath)
            return {
                ...d,
                dependencyPath,
                installedPath: path.join(process.cwd(), d.path),
                globalPath,
                globalPathExists,
                realPath,
                realProject: realPath.replace(d.path.startsWith('/') ? d.path : `/${d.path}`, '')
            }
        }

        return false
    }))

    const problematicDependencies = realPaths
        .filter(d => typeof d !== 'boolean')
        .filter((d) => d.installedPath !== d.realPath)

    if (problematicDependencies.length > 0) {
        console.log(`You have ${problematicDependencies.length} ${problematicDependencies.length > 1 ? 'dependencies' : 'dependency'} with incorrect path!`)
        for (const d of problematicDependencies) {
            console.log(d.name);
            console.log(`your path: ${chalk.yellow(d.installedPath)}
while, real path: ${chalk.green(d.realPath)}`);
        }

        const confirmPrompt = new Select({
            message: 'Do you want to fix them?',
            choices: [
                {
                    message: 'Sure',
                    name: 'fix dependencies'
                },
                {
                    message: 'I\'ll with this myself',
                    name: 'no'
                }
            ]
        })

        let result

        try {
            result = await confirmPrompt.run()
        } catch (e) {
            return
        }

        if (result !== 'no') {
            await Promise.all(problematicDependencies.map(async (d) => {
                if (d.globalPathExists) {
                    await fs.promises.unlink(d.globalPath)
                }

                await fs.promises.unlink(d.dependencyPath)

                await fs.promises.symlink(d.installedPath, d.globalPath)
                await fs.promises.symlink(d.globalPath, d.dependencyPath)
            }))

            console.log('done!');
        }
    } else {
        console.log('no issues found! you are good to go!')
    }
}()